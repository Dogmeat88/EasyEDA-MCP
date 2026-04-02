import { strict as assert } from 'node:assert';
import test from 'node:test';

import { syncBridgeHeaderMenus } from '../src/bridge-header-menus';
import { getSchematicNetLabelCapabilitySummary } from '../src/bridge-runtime-capabilities';
import { findAddedPrimitiveIds } from '../src/primitive-id-diff';
import { buildSchematicPinStubLine } from '../src/schematic-pin-stub';

function createPin(x: number, y: number, rotation: number, pinLength = 10) {
	return {
		getState_X: () => x,
		getState_Y: () => y,
		getState_Rotation: () => rotation,
		getState_PinLength: () => pinLength,
	};
}

test('buildSchematicPinStubLine follows pin rotation when no explicit offset is provided', () => {
	assert.deepEqual(buildSchematicPinStubLine(createPin(100, 200, 0)), [100, 200, 120, 200]);
	assert.deepEqual(buildSchematicPinStubLine(createPin(100, 200, 180)), [100, 200, 80, 200]);
	assert.deepEqual(buildSchematicPinStubLine(createPin(100, 200, 90)), [100, 200, 100, 180]);
	assert.deepEqual(buildSchematicPinStubLine(createPin(100, 200, 270)), [100, 200, 100, 220]);
});

test('buildSchematicPinStubLine honors explicit offsets as direct relative endpoints', () => {
	assert.deepEqual(buildSchematicPinStubLine(createPin(50, 75, 0), 30, -15), [50, 75, 80, 60]);
	assert.deepEqual(buildSchematicPinStubLine(createPin(50, 75, 180), undefined, 10), [50, 75, 50, 85]);
});

test('findAddedPrimitiveIds returns only newly created primitive ids in order', () => {
	assert.deepEqual(findAddedPrimitiveIds(['e0', 'e1'], ['e0', 'e1', 'e2', 'e4']), ['e2', 'e4']);
	assert.deepEqual(findAddedPrimitiveIds(['e0', 'e1'], ['e0', 'e1']), []);
});

test('getSchematicNetLabelCapabilitySummary reports live host limitations and fallbacks', () => {
	assert.deepEqual(getSchematicNetLabelCapabilitySummary(undefined), {
		attributeApiAvailable: false,
		createNetLabelAvailable: false,
		supported: false,
		unsupportedMethods: ['add_schematic_net_label', 'modify_schematic_net_label'],
		recommendedFallbackToolsByMethod: {
			add_schematic_net_label: ['connect_schematic_pin_to_net', 'connect_schematic_pins_to_nets', 'connect_schematic_pins_with_prefix', 'add_schematic_wire'],
			modify_schematic_net_label: ['get_document_source', 'set_document_source'],
		},
		warning: 'This EasyEDA runtime does not expose sch_PrimitiveAttribute. Net-label creation and modification are unavailable on this host build.',
	});

	assert.deepEqual(getSchematicNetLabelCapabilitySummary({}), {
		attributeApiAvailable: true,
		createNetLabelAvailable: false,
		supported: false,
		unsupportedMethods: ['add_schematic_net_label', 'modify_schematic_net_label'],
		recommendedFallbackToolsByMethod: {
			add_schematic_net_label: ['connect_schematic_pin_to_net', 'connect_schematic_pins_to_nets', 'connect_schematic_pins_with_prefix', 'add_schematic_wire'],
			modify_schematic_net_label: ['get_document_source', 'set_document_source'],
		},
		warning: 'This EasyEDA runtime does not expose sch_PrimitiveAttribute.createNetLabel. Net-label creation is unavailable on this host build.',
	});

	assert.deepEqual(getSchematicNetLabelCapabilitySummary({ createNetLabel() {} }), {
		attributeApiAvailable: true,
		createNetLabelAvailable: true,
		supported: true,
		unsupportedMethods: [],
		recommendedFallbackToolsByMethod: {},
	});
});

test('syncBridgeHeaderMenus reasserts the bridge header menu definition', async () => {
	const replaceHeaderMenusCalls: unknown[] = [];
	await syncBridgeHeaderMenus({
		replaceHeaderMenus: async (menus: unknown) => {
			replaceHeaderMenusCalls.push(menus);
		},
	});

	assert.equal(replaceHeaderMenusCalls.length, 1);
	assert.deepEqual(replaceHeaderMenusCalls[0], [
		{
			id: 'EasyEDA MCP Bridge',
			title: 'EasyEDA MCP Bridge',
			menuItems: [
				{
					id: 'MCP Bridge Reconnect',
					title: 'Reconnect',
					registerFn: 'bridgeReconnect',
				},
				{
					id: 'MCP Bridge Status',
					title: 'Status',
					registerFn: 'bridgeStatus',
				},
			],
		},
	]);
});
