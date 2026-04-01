import type { IncomingMessage } from 'node:http';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { WebSocketServer } from 'ws';

import { EasyedaBridgeSession } from './bridge-session';
import { DEFAULT_BRIDGE_PATH, DEFAULT_BRIDGE_PORT } from './mcp-bridge-protocol';
import type { BridgeMethod } from './mcp-bridge-protocol';
import { registerEasyedaTools } from './mcp-tools';

const bridgeHost = process.env.EASYEDA_MCP_BRIDGE_HOST ?? '127.0.0.1';
const bridgePath = process.env.EASYEDA_MCP_BRIDGE_PATH ?? DEFAULT_BRIDGE_PATH;
const bridgePort = Number(process.env.EASYEDA_MCP_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT);
const requestTimeoutMs = Number(process.env.EASYEDA_MCP_BRIDGE_TIMEOUT_MS ?? 30_000);
const mcpHttpEnabled = process.env.EASYEDA_MCP_HTTP_ENABLED !== '0';
const mcpHttpHost = process.env.EASYEDA_MCP_HTTP_HOST ?? '127.0.0.1';
const mcpHttpPort = Number(process.env.EASYEDA_MCP_HTTP_PORT ?? 19733);
const mcpHttpPath = process.env.EASYEDA_MCP_HTTP_PATH ?? '/mcp';
const serverPidFile = process.env.EASYEDA_MCP_PID_FILE ?? join(tmpdir(), 'easyeda-mcp-server.pid');
const execFileAsync = promisify(execFile);

function getMethodTimeoutOverride(method: BridgeMethod, floorMs: number): number {
	const envKey = `EASYEDA_MCP_${method.toUpperCase()}_TIMEOUT_MS`;
	const envValue = process.env[envKey];
	if (!envValue)
		return Math.max(requestTimeoutMs, floorMs);

	const parsedValue = Number(envValue);
	if (!Number.isFinite(parsedValue) || parsedValue <= 0)
		return Math.max(requestTimeoutMs, floorMs);

	return parsedValue;
}

const requestTimeoutOverrides: Partial<Record<BridgeMethod, number>> = {
	get_current_context: getMethodTimeoutOverride('get_current_context', 20_000),
	list_project_objects: getMethodTimeoutOverride('list_project_objects', 20_000),
	search_library_devices: getMethodTimeoutOverride('search_library_devices', 20_000),
	get_schematic_primitive: getMethodTimeoutOverride('get_schematic_primitive', 20_000),
	get_schematic_primitives_bbox: getMethodTimeoutOverride('get_schematic_primitives_bbox', 20_000),
	get_pcb_primitive: getMethodTimeoutOverride('get_pcb_primitive', 20_000),
	get_pcb_primitives_bbox: getMethodTimeoutOverride('get_pcb_primitives_bbox', 20_000),
	get_document_source: getMethodTimeoutOverride('get_document_source', 60_000),
	set_document_source: getMethodTimeoutOverride('set_document_source', 120_000),
};

const bridgeSession = new EasyedaBridgeSession({
	bridgeHost,
	bridgePath,
	bridgePort,
	requestTimeoutMs,
	requestTimeoutOverrides,
	serverName: 'easyeda-mcp-server',
});

const stdioServer = createMcpServer();

if (require.main === module)
	void start().catch(handleStartFailure);

async function start(): Promise<void> {
	await restartExistingServerIfNeeded();
	const wsServer = await createWsServer();
	const httpServer = mcpHttpEnabled ? await startHttpServer() : undefined;
	registerShutdownHandlers(wsServer, httpServer);
	await writeCurrentServerPid();
	const transport = new StdioServerTransport();
	await stdioServer.connect(transport);
}

function createMcpServer(): McpServer {
	const server = new McpServer(
		{
			name: 'easyeda-mcp-server',
			version: '0.1.0',
		},
		{
			instructions: [
				'Connects to an EasyEDA Pro extension over a localhost WebSocket bridge.',
				'Start with bridge_status to verify connectivity, then call get_current_context to determine whether EasyEDA currently exposes project context, document context, or neither.',
				'When you need project inventory, call list_project_objects before document lifecycle or rename/delete operations.',
				'For placement workflows, prefer search_library_devices before add_schematic_component or add_pcb_component.',
				'For geometry or editing workflows, prefer the query tools first: list_*_primitive_ids, get_*_primitive, get_*_primitives_bbox, list_schematic_component_pins, and list_pcb_component_pads.',
				'Use get_document_source before set_document_source unless you are explicitly forcing an overwrite. Pass expectedSourceHash whenever possible.',
				'Current limitations: no true autorouter/pathfinding API is available through this bridge, and schematic net label deletion is not exposed by the host SDK.',
				'If you need a concise operational primer, call get_usage_guide.',
			].join(' '),
		},
	);

	registerEasyedaTools(server, bridgeSession);
	return server;
}

async function createWsServer(): Promise<WebSocketServer> {
	const wsServer = await new Promise<WebSocketServer>((resolve, reject) => {
		const server = new WebSocketServer({
			host: bridgeHost,
			path: bridgePath,
			port: bridgePort,
		});

		server.once('listening', () => {
			server.off('error', reject);
			resolve(server);
		});
		server.once('error', reject);
	});

	wsServer.on('connection', (socket) => {
		bridgeSession.setSocket(socket);

		socket.on('message', (rawMessage) => {
			bridgeSession.handleRawMessage(rawMessage.toString());
		});

		socket.on('close', () => {
			bridgeSession.handleSocketClosed();
		});

		socket.on('error', () => {
			bridgeSession.handleSocketClosed();
		});
	});

	return wsServer;
}

async function startHttpServer(): Promise<ReturnType<typeof createServer>> {
	const httpServer = createServer(async (req, res) => {
		const requestUrl = new URL(req.url ?? '/', `http://${mcpHttpHost}:${mcpHttpPort}`);
		if (requestUrl.pathname !== mcpHttpPath) {
			res.statusCode = 404;
			res.end('Not found');
			return;
		}

		if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
			res.statusCode = 405;
			res.end('Method not allowed');
			return;
		}

		const server = createMcpServer();
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
		});

		res.on('close', () => {
			void transport.close();
			void server.close();
		});

		try {
			await server.connect(transport);
			const parsedBody = req.method === 'POST' ? await readJsonBody(req) : undefined;
			await transport.handleRequest(req, res, parsedBody);
		}
		catch (error: unknown) {
			console.error('MCP HTTP transport failed:', error);
			if (!res.headersSent) {
				res.statusCode = 500;
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32603,
						message: error instanceof Error ? error.message : 'Internal server error',
					},
					id: null,
				}));
			}
		}
	});

	await new Promise<void>((resolve, reject) => {
		httpServer.once('error', reject);
		httpServer.listen(mcpHttpPort, mcpHttpHost, () => {
			httpServer.off('error', reject);
			console.error(`MCP HTTP endpoint listening on http://${mcpHttpHost}:${mcpHttpPort}${mcpHttpPath}`);
			resolve();
		});
	});

	return httpServer;
}

async function restartExistingServerIfNeeded(): Promise<void> {
	const restartPids = new Set<number>();
	const existingPid = await readExistingServerPid();
	if (existingPid && existingPid !== process.pid) {
		if (isProcessRunning(existingPid))
			restartPids.add(existingPid);
		else
			await removeServerPidFile();
	}

	for (const pid of await getListenerPids()) {
		if (pid !== process.pid)
			restartPids.add(pid);
	}

	for (const pid of restartPids) {
		if (!isProcessRunning(pid))
			continue;

		console.error(`Restarting existing MCP server process ${pid}`);
		process.kill(pid, 'SIGTERM');
		await waitForProcessExit(pid, 5000);
	}

	await removeServerPidFile();
}

async function readExistingServerPid(): Promise<number | undefined> {
	try {
		const rawPid = (await readFile(serverPidFile, 'utf8')).trim();
		if (!rawPid)
			return undefined;

		const pid = Number(rawPid);
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	}
	catch {
		return undefined;
	}
}

async function writeCurrentServerPid(): Promise<void> {
	await writeFile(serverPidFile, `${process.pid}\n`, 'utf8');
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	}
	catch {
		return false;
	}
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isProcessRunning(pid))
			return;

		await delay(100);
	}

	if (!isProcessRunning(pid))
		return;

	process.kill(pid, 'SIGKILL');
	const killDeadline = Date.now() + 2000;
	while (Date.now() < killDeadline) {
		if (!isProcessRunning(pid))
			return;

		await delay(100);
	}

	throw new Error(`Timed out waiting for existing MCP server process ${pid} to exit`);
}

async function getListenerPids(): Promise<number[]> {
	if (process.platform !== 'linux')
		return [];

	try {
		const { stdout } = await execFileAsync('ss', ['-ltnp']);
		const portTokens = [`:${bridgePort}`, `:${mcpHttpPort}`];
		const pids = new Set<number>();
		for (const line of stdout.split(/\r?\n/)) {
			if (!portTokens.some(token => line.includes(token)))
				continue;

			for (const match of line.matchAll(/pid=(\d+)/g)) {
				const pid = Number(match[1]);
				if (Number.isInteger(pid) && pid > 0)
					pids.add(pid);
			}
		}

		return [...pids];
	}
	catch {
		return [];
	}
}

function registerShutdownHandlers(wsServer: WebSocketServer, httpServer?: ReturnType<typeof createServer>): void {
	let shuttingDown = false;
	const shutdown = async () => {
		if (shuttingDown)
			return;

		shuttingDown = true;
		await Promise.allSettled([
			closeWsServer(wsServer),
			httpServer ? closeHttpServer(httpServer) : Promise.resolve(),
			stdioServer.close(),
			removeServerPidFile(),
		]);
		process.exit(0);
	};

	process.once('SIGINT', () => {
		void shutdown();
	});
	process.once('SIGTERM', () => {
		void shutdown();
	});
	process.once('exit', () => {
		void removeServerPidFile();
	});
}

function closeWsServer(wsServer: WebSocketServer): Promise<void> {
	return new Promise((resolve) => {
		wsServer.close(() => {
			resolve();
		});
	});
}

function closeHttpServer(httpServer: ReturnType<typeof createServer>): Promise<void> {
	return new Promise((resolve, reject) => {
		httpServer.close((error) => {
			if (error) {
				reject(error);
				return;
			}

			resolve();
		});
	});
}

async function removeServerPidFile(): Promise<void> {
	try {
		const currentPid = await readExistingServerPid();
		if (currentPid !== undefined && currentPid !== process.pid)
			return;

		await rm(serverPidFile, { force: true });
	}
	catch {
		// Best effort cleanup only.
	}
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function handleStartFailure(error: unknown): void {
	console.error(error instanceof Error ? error.message : error);
	void removeServerPidFile();
	process.exitCode = 1;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req)
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);

	const rawBody = Buffer.concat(chunks).toString('utf8').trim();
	if (!rawBody)
		return undefined;

	return JSON.parse(rawBody);
}
