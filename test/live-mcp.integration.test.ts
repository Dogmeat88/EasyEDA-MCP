import { strict as assert } from 'node:assert';
import process from 'node:process';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const liveTestEnabled = process.env.EASYEDA_MCP_LIVE_TEST === '1';
const requireConnectedBridge = process.env.EASYEDA_MCP_LIVE_REQUIRE_CONNECTED === '1';
const attachToExistingServer = process.env.EASYEDA_MCP_LIVE_ATTACH_EXISTING === '1';
const existingServerUrl = process.env.EASYEDA_MCP_LIVE_SERVER_URL ?? 'http://127.0.0.1:19733/mcp';

test('live MCP server exposes tools and responds to bridge queries', { skip: !liveTestEnabled }, async (t) => {
	const client = new Client(
		{
			name: 'easyeda-live-test',
			version: '0.1.0',
		},
		{
			capabilities: {},
		},
	);
	const transport = attachToExistingServer
		? new StreamableHTTPClientTransport(new URL(existingServerUrl))
		: new StdioClientTransport({
				command: 'npm',
				args: ['run', 'mcp:server'],
				cwd: process.cwd(),
				stderr: 'pipe',
			});

	t.after(async () => {
		await client.close();
	});

	await client.connect(transport);

	const toolList = await client.listTools();
	const toolNames = toolList.tools.map(tool => tool.name);
	assert.ok(toolNames.includes('bridge_status'));
	assert.ok(toolNames.includes('ping_bridge'));
	assert.ok(toolNames.includes('echo_bridge'));
	assert.ok(toolNames.includes('search_library_devices'));
	assert.ok(toolNames.includes('get_pcb_net'));

	const bridgeStatusResult = await client.callTool({ name: 'bridge_status', arguments: {} });
	assert.ok('structuredContent' in bridgeStatusResult);
	const bridgeStatus = (bridgeStatusResult.structuredContent ?? {}) as Record<string, unknown>;
	assert.equal(typeof bridgeStatus.connected, 'boolean');

	if (bridgeStatus.connected !== true) {
		if (requireConnectedBridge)
			assert.fail('Expected a live EasyEDA bridge connection');

		return;
	}

	const pingResult = await client.callTool({ name: 'ping_bridge', arguments: {} });
	assert.ok('structuredContent' in pingResult);
	const ping = (pingResult.structuredContent ?? {}) as Record<string, unknown>;
	assert.equal(ping.ok, true);
	assert.equal(ping.pong, true);

	const echoResult = await client.callTool({ name: 'echo_bridge', arguments: { message: 'hello bridge' } });
	assert.ok('structuredContent' in echoResult);
	const echo = (echoResult.structuredContent ?? {}) as Record<string, unknown>;
	assert.equal(echo.ok, true);
	assert.equal(echo.message, 'hello bridge');

	if (!requireConnectedBridge)
		return;

	const currentContextResult = await client.callTool({ name: 'get_current_context', arguments: {} });
	assert.ok('structuredContent' in currentContextResult);
	const currentContext = (currentContextResult.structuredContent ?? {}) as Record<string, unknown>;
	assert.ok(currentContext);
	const hasProjectContext = typeof currentContext.currentProject === 'object' && currentContext.currentProject !== null;
	const hasDocumentContext = typeof currentContext.currentDocument === 'object' && currentContext.currentDocument !== null;
	assert.equal(hasProjectContext || hasDocumentContext, true);

	const capabilityResult = await client.callTool({ name: 'get_capabilities', arguments: {} });
	assert.ok('structuredContent' in capabilityResult);
	const capability = (capabilityResult.structuredContent ?? {}) as Record<string, unknown>;
	assert.equal(capability.connected, true);
});
