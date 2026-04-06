import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildPcbPolylineSource } from '../src/pcb-polyline';

test('buildPcbPolylineSource emits EasyEDA polyline source arrays for waypoint routes', () => {
	assert.deepEqual(buildPcbPolylineSource([
		{ x: 10, y: 20 },
		{ x: 30, y: 20 },
		{ x: 30, y: 40 },
	]), [10, 20, 'L', 30, 20, 'L', 30, 40]);
});

test('buildPcbPolylineSource rejects degenerate paths', () => {
	assert.throws(() => buildPcbPolylineSource([{ x: 10, y: 20 }]), /At least two points/);
});