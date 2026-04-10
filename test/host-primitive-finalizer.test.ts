import { strict as assert } from 'node:assert';
import test from 'node:test';

import { finalizeHostPrimitive } from '../src/host-primitive-finalizer';

test('finalizeHostPrimitive returns the original value when no done method exists', async () => {
	const primitive = { primitiveId: 'e1' };

	assert.equal(await finalizeHostPrimitive(primitive), primitive);
});

test('finalizeHostPrimitive awaits done() on direct primitives', async () => {
	const finalizedPrimitive = { primitiveId: 'e2' };
	let doneCalls = 0;
	const primitive = {
		primitiveId: 'draft',
		async done() {
			doneCalls += 1;
			return finalizedPrimitive;
		},
	};

	assert.equal(await finalizeHostPrimitive(primitive), finalizedPrimitive);
	assert.equal(doneCalls, 1);
});

test('finalizeHostPrimitive unwraps single-item arrays before calling done()', async () => {
	const finalizedPrimitive = { primitiveId: 'e3' };
	let doneCalls = 0;
	const primitive = [{
		primitiveId: 'draft-array-item',
		async done() {
			doneCalls += 1;
			return finalizedPrimitive;
		},
	}];

	assert.equal(await finalizeHostPrimitive(primitive), finalizedPrimitive);
	assert.equal(doneCalls, 1);
});

test('finalizeHostPrimitive leaves multi-item arrays untouched', async () => {
	const primitives = [{ primitiveId: 'e4' }, { primitiveId: 'e5' }];

	assert.equal(await finalizeHostPrimitive(primitives), primitives);
});
