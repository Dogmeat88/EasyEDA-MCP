import { strict as assert } from 'node:assert';
import test from 'node:test';

import { normalizePcbLineLayerForHost } from '../src/pcb-layer';

test('normalizePcbLineLayerForHost converts EasyEDA line layer aliases to numeric host ids', () => {
	assert.equal(normalizePcbLineLayerForHost('TopLayer'), 1);
	assert.equal(normalizePcbLineLayerForHost('BottomLayer'), 2);
	assert.equal(normalizePcbLineLayerForHost('BoardOutLine'), 11);
});

test('normalizePcbLineLayerForHost preserves numeric ids and unknown values', () => {
	assert.equal(normalizePcbLineLayerForHost(1), 1);
	assert.equal(normalizePcbLineLayerForHost('Inner1'), 'Inner1');
});