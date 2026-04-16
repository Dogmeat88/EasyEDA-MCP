import { strict as assert } from 'node:assert';
import test from 'node:test';

import { getPcbPadRouteAnchor } from '../src/pcb-pad-anchor';

function createPad(overrides?: Partial<{
	x: number;
	y: number;
	rotation: number;
	width: number;
	height: number;
	diameter: number;
	holeDiameter: number;
	pad: unknown;
	hole: unknown;
}>) {
	const state = {
		x: overrides?.x ?? 100,
		y: overrides?.y ?? 200,
		rotation: overrides?.rotation ?? 0,
		width: overrides?.width,
		height: overrides?.height,
		diameter: overrides?.diameter,
		holeDiameter: overrides?.holeDiameter,
		pad: overrides?.pad,
		hole: overrides?.hole,
	};

	return {
		getState_X: () => state.x,
		getState_Y: () => state.y,
		getState_Rotation: () => state.rotation,
		getState_Width: state.width === undefined ? undefined : () => state.width,
		getState_Height: state.height === undefined ? undefined : () => state.height,
		getState_Diameter: state.diameter === undefined ? undefined : () => state.diameter,
		getState_HoleDiameter: state.holeDiameter === undefined ? undefined : () => state.holeDiameter,
		getState_Pad: state.pad === undefined ? undefined : () => state.pad,
		getState_Hole: state.hole === undefined ? undefined : () => state.hole,
	};
}

test('getPcbPadRouteAnchor moves a rectangular pad anchor toward the target while staying inside copper', () => {
	const anchor = getPcbPadRouteAnchor(createPad({ width: 40, height: 20 }), { x: 180, y: 200 }, 10);

	assert.equal(anchor.y, 200);
	assert.ok(anchor.x > 100);
	assert.ok(anchor.x < 120);
});

test('getPcbPadRouteAnchor respects pad rotation when resolving the pad edge', () => {
	const anchor = getPcbPadRouteAnchor(createPad({ width: 40, height: 20, rotation: 90 }), { x: 100, y: 280 }, 10);

	assert.equal(anchor.x, 100);
	assert.ok(anchor.y > 200);
	assert.ok(anchor.y < 220);
});

test('getPcbPadRouteAnchor respects radian rotation values from the live EasyEDA pad API', () => {
	const anchor = getPcbPadRouteAnchor(createPad({ width: 40, height: 20, rotation: Math.PI / 2 }), { x: 100, y: 280 }, 10);

	assert.equal(anchor.x, 100);
	assert.ok(anchor.y > 200);
	assert.ok(anchor.y < 220);
});

test('getPcbPadRouteAnchor falls back to circular diameter for through-hole style pads', () => {
	const anchor = getPcbPadRouteAnchor(createPad({ diameter: 60 }), { x: 160, y: 200 }, 10);

	assert.equal(anchor.y, 200);
	assert.ok(anchor.x > 120);
	assert.ok(anchor.x < 130);
});

test('getPcbPadRouteAnchor snaps circular pad anchors to a cardinal side for diagonal targets', () => {
	const anchor = getPcbPadRouteAnchor(createPad({ diameter: 60 }), { x: 180, y: 260 }, 10);

	assert.equal(anchor.y, 200);
	assert.ok(anchor.x > 120);
	assert.ok(anchor.x < 130);
});

test('getPcbPadRouteAnchor snaps symmetric width-height pads to a cardinal side for diagonal targets', () => {
	const anchor = getPcbPadRouteAnchor(createPad({ width: 40, height: 40 }), { x: 180, y: 260 }, 10);

	assert.equal(anchor.y, 200);
	assert.ok(anchor.x > 110);
	assert.ok(anchor.x < 120);
});

test('getPcbPadRouteAnchor uses getState_Pad tuple geometry when width and height getters are unavailable', () => {
	const anchor = getPcbPadRouteAnchor(createPad({ pad: ['RECT', 60, 60, 0] }), { x: 180, y: 200 }, 10);

	assert.equal(anchor.y, 200);
	assert.ok(anchor.x > 120);
	assert.ok(anchor.x < 130);
});

test('getPcbPadRouteAnchor snaps hole-diameter fallbacks to a cardinal side for vertical exits', () => {
	const anchor = getPcbPadRouteAnchor(createPad({ holeDiameter: 40 }), { x: 104, y: 280 }, 10);

	assert.equal(anchor.x, 100);
	assert.equal(anchor.y, 220);
});

test('getPcbPadRouteAnchor returns the pad center for degenerate zero-length routes', () => {
	const anchor = getPcbPadRouteAnchor(createPad({ width: 40, height: 20 }), { x: 100, y: 200 }, 10);

	assert.deepEqual(anchor, { x: 100, y: 200 });
});