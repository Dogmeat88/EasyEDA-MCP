import { strict as assert } from 'node:assert';
import test from 'node:test';

import { findPcbComponentPadPrimitiveId, findResolvedPcbPad } from '../src/pcb-pad-geometry';

function createPad(primitiveId: string, padNumber: string) {
	return {
		getState_PrimitiveId: () => primitiveId,
		getState_PadNumber: () => padNumber,
	};
}

test('findPcbComponentPadPrimitiveId returns the exact component pad primitive id', () => {
	assert.equal(findPcbComponentPadPrimitiveId({
		pads: [
			{ primitiveId: 'e18e51', padNumber: 'J3-15' },
			{ primitiveId: 'e18e65', padNumber: 'J3-1' },
		],
	}, 'J3-15'), 'e18e51');
});

test('findResolvedPcbPad prefers the real pcb_PrimitivePad inventory entry over a legacy component pin view', () => {
	const resolved = findResolvedPcbPad('e18', 'J3-15', {
		pads: [{ primitiveId: 'e18e51', padNumber: 'J3-15' }],
	}, [
		createPad('legacy-J3-15', 'J3-15'),
		createPad('e18e51', 'J3-15'),
	]);

	assert.equal(resolved?.getState_PrimitiveId(), 'e18e51');
});

test('findResolvedPcbPad falls back to component-scoped primitive ids when component metadata is missing', () => {
	const resolved = findResolvedPcbPad('e17', '1', undefined, [
		createPad('e17e8', '1'),
		createPad('e19e22', '1'),
	]);

	assert.equal(resolved?.getState_PrimitiveId(), 'e17e8');
});
