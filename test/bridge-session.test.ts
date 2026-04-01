import { strict as assert } from 'node:assert';
import test from 'node:test';

import { EasyedaBridgeSession } from '../src/bridge-session';
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

function createSession(requestTimeoutMs = 50): EasyedaBridgeSession {
	return new EasyedaBridgeSession({
		bridgeHost: '127.0.0.1',
		bridgePath: '/easyeda-mcp',
		bridgePort: 19732,
		requestTimeoutMs,
		serverName: 'test-server',
	});
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

test('call resolves the matching response even when responses arrive out of order', async () => {
	const session = createSession();
	const socket = new FakeSocket();
	session.setSocket(socket);

	const firstCall = session.call('get_capabilities');
	const secondCall = session.call('get_current_context');

	const firstRequest = parseBridgeEnvelope(socket.sent[1]);
	const secondRequest = parseBridgeEnvelope(socket.sent[2]);

	assert.equal(firstRequest?.type, 'request');
	assert.equal(secondRequest?.type, 'request');

	session.handleRawMessage(serializeBridgeEnvelope({
		protocolVersion: 1,
		type: 'response',
		requestId: secondRequest!.requestId!,
		ok: true,
		result: { order: 'second' },
	}));
	session.handleRawMessage(serializeBridgeEnvelope({
		protocolVersion: 1,
		type: 'response',
		requestId: firstRequest!.requestId!,
		ok: true,
		result: { order: 'first' },
	}));

	assert.deepEqual(await firstCall, { order: 'first' });
	assert.deepEqual(await secondCall, { order: 'second' });
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

test('pending calls reject when the socket closes', async () => {
	const session = createSession(100);
	const socket = new FakeSocket();
	session.setSocket(socket);

	const pendingCall = session.call('get_current_context');
	session.handleSocketClosed();

	await assert.rejects(
		pendingCall,
		/EasyEDA bridge disconnected while waiting for/,
	);
	assert.equal(session.getConnectionState().pendingRequestCount, 0);
});
