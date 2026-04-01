import type { BridgeMethod } from './mcp-bridge-protocol';

import { randomUUID } from 'node:crypto';
import {
	BRIDGE_PROTOCOL_VERSION,
	createServerHello,
	parseBridgeEnvelope,
	serializeBridgeEnvelope,
} from './mcp-bridge-protocol';

export interface BridgeSocketLike {
	OPEN: number;
	readyState: number;
	send: (payload: string) => void;
	close: () => void;
}

export interface EasyedaBridgeSessionOptions {
	bridgeHost: string;
	bridgePath: string;
	bridgePort: number;
	requestTimeoutMs: number;
	serverName?: string;
}

export class EasyedaBridgeSession {
	private socket?: BridgeSocketLike;
	private helloPayload?: Record<string, unknown>;
	private readonly pendingRequests = new Map<
		string,
		{
			resolve: (value: unknown) => void;
			reject: (reason?: unknown) => void;
			timeout: NodeJS.Timeout;
		}
	>();

	constructor(private readonly options: EasyedaBridgeSessionOptions) {}

	setSocket(socket: BridgeSocketLike): void {
		if (this.socket && this.socket !== socket)
			this.socket.close();

		this.socket = socket;
		this.helloPayload = undefined;
		this.socket.send(serializeBridgeEnvelope(createServerHello({
			bridgeHost: this.options.bridgeHost,
			bridgePath: this.options.bridgePath,
			bridgePort: this.options.bridgePort,
			serverName: this.options.serverName ?? 'easyeda-mcp-server',
		})));
	}

	handleRawMessage(rawMessage: string): void {
		const envelope = parseBridgeEnvelope(rawMessage);
		if (!envelope)
			return;

		if (envelope.type === 'hello') {
			this.helloPayload = envelope.payload;
			return;
		}

		if (envelope.type !== 'response')
			return;

		const pendingRequest = this.pendingRequests.get(envelope.requestId);
		if (!pendingRequest)
			return;

		clearTimeout(pendingRequest.timeout);
		this.pendingRequests.delete(envelope.requestId);

		if (envelope.ok)
			pendingRequest.resolve(envelope.result);
		else
			pendingRequest.reject(new Error(envelope.error?.message ?? 'Unknown EasyEDA bridge error'));
	}

	handleSocketClosed(): void {
		this.socket = undefined;
		for (const [requestId, pendingRequest] of this.pendingRequests) {
			clearTimeout(pendingRequest.timeout);
			pendingRequest.reject(new Error(`EasyEDA bridge disconnected while waiting for ${requestId}`));
		}

		this.pendingRequests.clear();
	}

	getConnectionState(): Record<string, unknown> {
		return {
			connected: Boolean(this.socket),
			helloPayload: this.helloPayload,
			pendingRequestCount: this.pendingRequests.size,
			bridgeHost: this.options.bridgeHost,
			bridgePort: this.options.bridgePort,
			bridgePath: this.options.bridgePath,
		};
	}

	async call(method: BridgeMethod, params?: Record<string, unknown>): Promise<unknown> {
		if (!this.socket || this.socket.readyState !== this.socket.OPEN)
			throw new Error('EasyEDA extension is not connected to the MCP bridge');

		const requestId = randomUUID();
		const response = await new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(requestId);
				reject(new Error(`EasyEDA bridge timed out waiting for ${method}`));
			}, this.options.requestTimeoutMs);

			this.pendingRequests.set(requestId, {
				resolve,
				reject,
				timeout,
			});

			this.socket?.send(serializeBridgeEnvelope({
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				type: 'request',
				requestId,
				method,
				params,
			}));
		});

		return response;
	}
}
