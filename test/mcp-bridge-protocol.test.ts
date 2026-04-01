import { strict as assert } from 'node:assert';
import test from 'node:test';

import { computeSourceRevision, parseBridgeEnvelope, serializeBridgeEnvelope } from '../src/mcp-bridge-protocol';

test('computeSourceRevision is deterministic for identical source', () => {
	assert.equal(computeSourceRevision('abc'), computeSourceRevision('abc'));
});

test('computeSourceRevision changes when source changes', () => {
	assert.notEqual(computeSourceRevision('abc'), computeSourceRevision('abcd'));
});

test('serializeBridgeEnvelope round-trips a valid message', () => {
	const serialized = serializeBridgeEnvelope({
		protocolVersion: 1,
		type: 'response',
		requestId: 'req-1',
		ok: true,
		result: { status: 'ok' },
	});

	assert.deepEqual(parseBridgeEnvelope(serialized), {
		protocolVersion: 1,
		type: 'response',
		requestId: 'req-1',
		ok: true,
		result: { status: 'ok' },
	});
});
