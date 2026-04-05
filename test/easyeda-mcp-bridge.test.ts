import { strict as assert } from 'node:assert';
import test from 'node:test';

import { computeSourceRevision } from '../src/mcp-bridge-protocol';
import { shouldSyncBridgeHeaderMenus, syncBridgeHeaderMenus } from '../src/bridge-header-menus';
import { getSchematicNetLabelCapabilitySummary } from '../src/bridge-runtime-capabilities';
import { withHostMethodTimeout } from '../src/host-method-timeout';
import { getOptionalTrimmedStringIncludingEmpty, resolvePcbLineNetForCreate } from '../src/pcb-line-net';
import { findAddedPrimitiveIds } from '../src/primitive-id-diff';
import { getImportReadbackStatus, verifyCreatedBoard, verifyCreatedPcb } from '../src/project-readback-guards';
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
	assert.deepEqual(buildSchematicPinStubLine(createPin(50, 75, 180), undefined, 10), [50, 75, 50, 85]);
	assert.deepEqual(buildSchematicPinStubLine(createPin(50, 75, 0), 30, -15), [50, 75, 80, 60]);
});

test('findAddedPrimitiveIds returns only newly created primitive ids in order', () => {
	assert.deepEqual(findAddedPrimitiveIds(['e0', 'e1'], ['e0', 'e1', 'e2', 'e4']), ['e2', 'e4']);
	assert.deepEqual(findAddedPrimitiveIds(['e0', 'e1'], ['e0', 'e1']), []);
});

test('resolvePcbLineNetForCreate defaults board outline lines to an empty net', () => {
	assert.equal(resolvePcbLineNetForCreate('BoardOutLine', undefined), '');
	assert.equal(resolvePcbLineNetForCreate('BoardOutLine', ''), '');
	assert.equal(resolvePcbLineNetForCreate('BoardOutLine', '  '), '');
	assert.equal(resolvePcbLineNetForCreate('TopLayer', 'GND'), 'GND');
	assert.throws(() => resolvePcbLineNetForCreate('TopLayer', ''), /Expected a non-empty string for net/);
});

test('getOptionalTrimmedStringIncludingEmpty preserves empty strings so pcb line nets can be cleared', () => {
	assert.equal(getOptionalTrimmedStringIncludingEmpty(' GND '), 'GND');
	assert.equal(getOptionalTrimmedStringIncludingEmpty(''), '');
	assert.equal(getOptionalTrimmedStringIncludingEmpty('   '), '');
	assert.equal(getOptionalTrimmedStringIncludingEmpty(undefined), undefined);
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

test('shouldSyncBridgeHeaderMenus skips runtime replacement when the bridge menu is already visible', () => {
	assert.equal(shouldSyncBridgeHeaderMenus({ body: { textContent: 'File\nSettings\nEasyEDA MCP Bridge\nHelp' } }), false);
	assert.equal(shouldSyncBridgeHeaderMenus({ body: { textContent: 'File\nSettings\nHelp' } }), true);
	assert.equal(shouldSyncBridgeHeaderMenus(undefined), true);
});

test('withHostMethodTimeout resolves when the host call completes in time', async () => {
	const result = await withHostMethodTimeout('host.method', 50, async () => 'ok');
	assert.equal(result, 'ok');
});

test('withHostMethodTimeout rejects with a compatibility hint when the host call hangs', async () => {
	await assert.rejects(
		() => withHostMethodTimeout(
			'pcb_PrimitiveString.create',
			10,
			() => new Promise(() => {}),
			'Host text APIs are unavailable.',
		),
		/pcb_PrimitiveString\.create timed out after 10ms\. Host text APIs are unavailable\./,
	);
});

test('verifyCreatedPcb confirms linked PCB creation from project inventory', () => {
	const result = verifyCreatedPcb([{ uuid: 'pcb-1', parentBoardName: 'Board1_3' }], 'pcb-1', 'Board1_3');

	assert.equal(result.parentBoardName, 'Board1_3');
	assert.equal(result.readbackVerified, true);
});

test('verifyCreatedPcb fails when EasyEDA returns an orphan PCB for a requested board name', () => {
	assert.throws(
		() => verifyCreatedPcb([{ uuid: 'pcb-1', parentBoardName: '' }], 'pcb-1', 'Board1_3'),
		/parent board none instead of Board1_3/,
	);
});

test('verifyCreatedBoard confirms linked schematic and PCB uuids from project inventory', () => {
	const result = verifyCreatedBoard([
		{
			boardName: 'Board1_3',
			schematic: { uuid: 'sch-1' },
			pcb: { uuid: 'pcb-1' },
		},
	], 'Board1_3', 'sch-1', 'pcb-1');

	assert.equal(result.actualSchematicUuid, 'sch-1');
	assert.equal(result.actualPcbUuid, 'pcb-1');
	assert.equal(result.readbackVerified, true);
});

test('getImportReadbackStatus fails verification when PCB source stays empty and unchanged', () => {
	const emptySource = '["HEADER"]';
	const result = getImportReadbackStatus(emptySource, emptySource, false);

	assert.equal(result.sourceChanged, false);
	assert.equal(result.readbackVerified, false);
	assert.deepEqual(result.beforeSummary, result.afterSummary);
});

test('getImportReadbackStatus succeeds when source readback gains imported components', () => {
	const beforeSource = '["HEADER"]';
	const afterSource = ['["HEADER"]', '["COMPONENT","e1"]', '["PAD_NET","e1","1","NET1"]'].join('\n');
	const result = getImportReadbackStatus(beforeSource, afterSource, false);

	assert.equal(result.readbackVerified, true);
	assert.equal(result.sourceChanged, true);
	assert.deepEqual(result.beforeSummary, {
		sourceHash: computeSourceRevision(beforeSource),
		componentCount: 0,
		padNetCount: 0,
		trackCount: 0,
		textCount: 0,
		viaCount: 0,
		totalParsedEntries: 1,
	});
	assert.deepEqual(result.afterSummary, {
		sourceHash: computeSourceRevision(afterSource),
		componentCount: 1,
		padNetCount: 1,
		trackCount: 0,
		textCount: 0,
		viaCount: 0,
		totalParsedEntries: 3,
	});
});
