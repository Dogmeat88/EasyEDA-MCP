import { strict as assert } from 'node:assert';
import test from 'node:test';

import { EasyedaBridgeSession } from '../src/bridge-session';
import type { BridgeMethod } from '../src/mcp-bridge-protocol';
import { parseBridgeEnvelope, serializeBridgeEnvelope } from '../src/mcp-bridge-protocol';

class FakeSocket {
	OPEN = 1;
	readyState = 1;
	readonly sent: string[] = [];
	closed = false;

	send(payload: string): void {
		this.sent.push(payload);
	}

	close(): void {
		this.closed = true;
	}
}

function createSession(
	requestTimeoutMs = 50,
	requestTimeoutOverrides?: Partial<Record<BridgeMethod, number>>,
): EasyedaBridgeSession {
	return new EasyedaBridgeSession({
		bridgeHost: '127.0.0.1',
		bridgePath: '/easyeda-mcp',
		bridgePort: 19732,
		requestTimeoutMs,
		requestTimeoutOverrides,
		serverName: 'test-server',
	});
}

async function flushQueuedDispatch(): Promise<void> {
	await new Promise(resolve => setImmediate(resolve));
}

async function waitForSentCount(socket: FakeSocket, expectedCount: number): Promise<void> {
	for (let index = 0; index < 5; index += 1) {
		if (socket.sent.length >= expectedCount)
			return;

		await flushQueuedDispatch();
	}
}

test('setSocket emits a server hello message', () => {
	const session = createSession();
	const socket = new FakeSocket();

	session.setSocket(socket);

	assert.equal(socket.sent.length, 1);
	const helloEnvelope = parseBridgeEnvelope(socket.sent[0]);
	assert.equal(helloEnvelope?.type, 'hello');
	assert.equal(helloEnvelope?.role, 'server');
});

test('call resolves queued bridge requests in submission order', async () => {
	const session = createSession();
	const socket = new FakeSocket();
	session.setSocket(socket);

	const firstCall = session.call('get_capabilities');
	const secondCall = session.call('get_current_context');
	await flushQueuedDispatch();

	const firstRequest = parseBridgeEnvelope(socket.sent[1]);

	assert.equal(firstRequest?.type, 'request');
	assert.equal(socket.sent.length, 2);

	session.handleRawMessage(serializeBridgeEnvelope({
		protocolVersion: 1,
		type: 'response',
		requestId: firstRequest!.requestId!,
		ok: true,
		result: { order: 'first' },
	}));

	await flushQueuedDispatch();
	const secondRequest = parseBridgeEnvelope(socket.sent[2]);
	assert.equal(secondRequest?.type, 'request');

	session.handleRawMessage(serializeBridgeEnvelope({
		protocolVersion: 1,
		type: 'response',
		requestId: secondRequest!.requestId!,
		ok: true,
		result: { order: 'second' },
	}));

	assert.deepEqual(await firstCall, { order: 'first' });
	assert.deepEqual(await secondCall, { order: 'second' });
});

test('call queues later bridge requests until the active request finishes', async () => {
	const session = createSession(100);
	const socket = new FakeSocket();
	session.setSocket(socket);

	const firstCall = session.call('get_capabilities');
	const secondCall = session.call('get_current_context');
	await flushQueuedDispatch();

	assert.equal(socket.sent.length, 2);
	const firstRequest = parseBridgeEnvelope(socket.sent[1]);
	assert.equal(firstRequest?.type, 'request');
	assert.equal(session.getConnectionState().queuedRequestCount, 1);

	session.handleRawMessage(serializeBridgeEnvelope({
		protocolVersion: 1,
		type: 'response',
		requestId: firstRequest!.requestId!,
		ok: true,
		result: { method: 'first' },
	}));

	await waitForSentCount(socket, 3);
	assert.equal(socket.sent.length, 3);
	const secondRequest = parseBridgeEnvelope(socket.sent[2]);
	assert.equal(secondRequest?.type, 'request');
	assert.equal(session.getConnectionState().queuedRequestCount, 0);

	session.handleRawMessage(serializeBridgeEnvelope({
		protocolVersion: 1,
		type: 'response',
		requestId: secondRequest!.requestId!,
		ok: true,
		result: { method: 'second' },
	}));

	assert.deepEqual(await firstCall, { method: 'first' });
	assert.deepEqual(await secondCall, { method: 'second' });
});

test('call rejects when the bridge times out', async () => {
	const session = createSession(5);
	const socket = new FakeSocket();
	session.setSocket(socket);

	await assert.rejects(
		session.call('get_capabilities'),
		/EasyEDA bridge timed out waiting for get_capabilities/,
	);
});

test('call uses method-specific timeout overrides for slow bridge methods', async () => {
	const session = createSession(10, { get_document_source: 60 });
	const socket = new FakeSocket();
	session.setSocket(socket);

	const pendingCall = session.call('get_document_source');
	await new Promise(resolve => setTimeout(resolve, 25));

	const request = parseBridgeEnvelope(socket.sent[1]);
	assert.equal(request?.type, 'request');

	session.handleRawMessage(serializeBridgeEnvelope({
		protocolVersion: 1,
		type: 'response',
		requestId: request!.requestId!,
		ok: true,
		result: { sourceHash: 'ok' },
	}));

	assert.deepEqual(await pendingCall, { sourceHash: 'ok' });
});

test('pending calls reject when the socket closes', async () => {
	const session = createSession(100);
	const socket = new FakeSocket();
	session.setSocket(socket);

	const pendingCall = session.call('get_current_context');
	await flushQueuedDispatch();
	session.handleSocketClosed();

	await assert.rejects(
		pendingCall,
		/EasyEDA bridge disconnected while waiting for/,
	);
	assert.equal(session.getConnectionState().pendingRequestCount, 0);
});
