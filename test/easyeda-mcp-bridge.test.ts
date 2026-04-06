import { strict as assert } from 'node:assert';
import test from 'node:test';

import { shouldSyncBridgeHeaderMenus, syncBridgeHeaderMenus } from '../src/bridge-header-menus';
import { getSchematicNetLabelCapabilitySummary } from '../src/bridge-runtime-capabilities';
import { allocateBridgeSocketId, shouldHandleBridgeSocketCallback } from '../src/bridge-socket-lifecycle';
import {
	buildEmptyPcbImportCompareMapFromSchematicNetlist,
	shouldAttemptBridgeWatchdogReconnect,
	shouldUseHostUiImportFallback,
} from '../src/easyeda-mcp-bridge';
import { describeEditorBootstrapState, getOpenDocumentBootstrapFailure, getRuntimeLocationHash, inferCurrentDocumentFromEditorShell } from '../src/editor-bootstrap-state';
import { EXTENSION_VERSION } from '../src/extension-metadata';
import { withHostMethodTimeout } from '../src/host-method-timeout';
import { computeSourceRevision } from '../src/mcp-bridge-protocol';
import { getOptionalTrimmedStringIncludingEmpty, resolvePcbLineNetForCreate } from '../src/pcb-line-net';
import { findAddedPrimitiveIds } from '../src/primitive-id-diff';
import {
	assertPcbCreationTargetAvailable,
	getImportReadbackStatus,
	getPcbImportTargetSnapshot,
	getSchematicTitleBlockAttributeFromSource,
	verifyCreatedBoard,
	verifyCreatedPcb,
	verifyPcbImportTarget,
} from '../src/project-readback-guards';
import { buildSchematicPinStubLine } from '../src/schematic-pin-stub';

function createPin(x: number, y: number, rotation: number, pinLength = 10) {
	return {
		getState_X: () => x,
		getState_Y: () => y,
		getState_Rotation: () => rotation,
		getState_PinLength: () => pinLength,
	};
}

test('allocateBridgeSocketId rotates socket ids across reconnect attempts', () => {
	assert.deepEqual(allocateBridgeSocketId('easyeda-mcp-bridge', 0), {
		socketId: 'easyeda-mcp-bridge',
		nextSequence: 1,
	});
	assert.deepEqual(allocateBridgeSocketId('easyeda-mcp-bridge', 1), {
		socketId: 'easyeda-mcp-bridge-2',
		nextSequence: 2,
	});
	assert.deepEqual(allocateBridgeSocketId('easyeda-mcp-bridge', 2), {
		socketId: 'easyeda-mcp-bridge-3',
		nextSequence: 3,
	});
});

test('shouldHandleBridgeSocketCallback filters stale websocket callbacks', () => {
	assert.equal(shouldHandleBridgeSocketCallback('easyeda-mcp-bridge-3', 'easyeda-mcp-bridge-3'), true);
	assert.equal(shouldHandleBridgeSocketCallback('easyeda-mcp-bridge-3', 'easyeda-mcp-bridge-2'), false);
	assert.equal(shouldHandleBridgeSocketCallback(undefined, 'easyeda-mcp-bridge'), false);
});

test('getRuntimeLocationHash tolerates undefined runtime location objects', () => {
	assert.equal(getRuntimeLocationHash({ hash: '#id=project-1' }), '#id=project-1');
	assert.equal(getRuntimeLocationHash({ hash: 123 }), '');
	assert.equal(getRuntimeLocationHash(undefined), '');
	assert.equal(getRuntimeLocationHash(null), '');
});

test('inferCurrentDocumentFromEditorShell recovers the active PCB tab from the top-level hash and iframe ids', () => {
	assert.deepEqual(
		inferCurrentDocumentFromEditorShell(
			{ documentType: -1, uuid: 'tab_page1' },
			'#id=project-1,tab=sch-1@project-1|*pcb-1@project-1',
			[{ id: 'frame_pcb-1@project-1', src: 'editor?entry=pcb' }],
		),
		{
			documentType: 3,
			inferredFromEditorShell: true,
			projectUuid: 'project-1',
			sourceFrameId: 'frame_pcb-1@project-1',
			uuid: 'pcb-1',
		},
	);
});

test('inferCurrentDocumentFromEditorShell stays silent when the editor shell has no matching iframe for the active tab', () => {
	assert.equal(
		inferCurrentDocumentFromEditorShell(
			{ documentType: -1, uuid: 'tab_page1' },
			'#id=project-1,tab=*pcb-1@project-1',
			[{ id: 'frame_other@project-1', src: 'editor?entry=pcb' }],
		),
		undefined,
	);
});

test('extension version is sourced from extension.json', async () => {
	const extensionManifest = await import('../extension.json');
	assert.equal(EXTENSION_VERSION, extensionManifest.default.version);
});

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

test('shouldAttemptBridgeWatchdogReconnect retries when a reload drops the bridge menu', () => {
	assert.equal(
		shouldAttemptBridgeWatchdogReconnect(
			{ started: true, connected: true, lastAttemptAt: 0 },
			{ body: { textContent: 'File\nSettings\nHelp' } },
			6_000,
			0,
		),
		true,
	);

	assert.equal(
		shouldAttemptBridgeWatchdogReconnect(
			{ started: true, connected: false, lastAttemptAt: 4_000 },
			{ body: { textContent: 'File\nSettings\nHelp' } },
			6_000,
			0,
		),
		false,
	);

	assert.equal(
		shouldAttemptBridgeWatchdogReconnect(
			{ started: true, connected: true, lastAttemptAt: 0 },
			{ body: { textContent: 'File\nSettings\nEasyEDA MCP Bridge\nHelp' } },
			6_000,
			0,
		),
		false,
	);
	assert.equal(
		shouldAttemptBridgeWatchdogReconnect(
			{ started: false, connected: false, lastAttemptAt: 0 },
			{ body: { textContent: 'File\nSettings\nHelp' } },
			6_000,
			0,
		),
		true,
	);
});

test('shouldUseHostUiImportFallback only retries unchanged empty PCB imports', () => {
	assert.equal(
		shouldUseHostUiImportFallback(true, false, { componentCount: 0 }, { componentCount: 0 }),
		true,
	);
	assert.equal(
		shouldUseHostUiImportFallback(false, false, { componentCount: 0 }, { componentCount: 0 }),
		false,
	);
	assert.equal(
		shouldUseHostUiImportFallback(true, true, { componentCount: 0 }, { componentCount: 0 }),
		false,
	);
	assert.equal(
		shouldUseHostUiImportFallback(true, false, { componentCount: 0 }, { componentCount: 1 }),
		false,
	);
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

test('verifyCreatedPcb fails clearly when EasyEDA does not return a PCB id', () => {
	assert.throws(
		() => verifyCreatedPcb([], undefined, 'Board1_3'),
		/did not return a PCB id/,
	);
});

test('verifyCreatedPcb fails when EasyEDA returns an orphan PCB for a requested board name', () => {
	assert.throws(
		() => verifyCreatedPcb([{ uuid: 'pcb-1', parentBoardName: '' }], 'pcb-1', 'Board1_3'),
		/parent board none instead of Board1_3/,
	);
});

test('assertPcbCreationTargetAvailable rejects boards that already have a linked PCB', () => {
	assert.throws(
		() => assertPcbCreationTargetAvailable([{ boardName: 'Board1_3', pcb: { uuid: 'pcb-1' } }], 'Board1_3'),
		/already linked to PCB pcb-1/,
	);
});

test('assertPcbCreationTargetAvailable allows boards without a linked PCB', () => {
	assert.doesNotThrow(
		() => assertPcbCreationTargetAvailable([{ boardName: 'Board1_3', schematic: { uuid: 'sch-1' } }], 'Board1_3'),
	);
});

test('verifyCreatedBoard confirms linked schematic and PCB uuids from project inventory', () => {
	const result = verifyCreatedBoard([
		{
			boardName: 'Board1_3',
			schematic: {
				uuid: 'sch-1',
				page: [{ titleBlockData: { '@Board Name': { value: 'Board1_3' } } }],
			},
			pcb: { uuid: 'pcb-1' },
		},
	], 'Board1_3', 'sch-1', 'pcb-1');

	assert.equal(result.actualSchematicUuid, 'sch-1');
	assert.equal(result.actualPcbUuid, 'pcb-1');
	assert.equal(result.titleBlockBoardName, 'Board1_3');
	assert.equal(result.readbackVerified, true);
});

test('verifyCreatedBoard fails when the linked schematic title block still advertises a different board name', () => {
	assert.throws(
		() => verifyCreatedBoard([
			{
				boardName: 'Board1_3',
				schematic: {
					uuid: 'sch-1',
					page: [{ titleBlockData: { '@Board Name': { value: 'Board1' } } }],
				},
				pcb: { uuid: 'pcb-1' },
			},
		], 'Board1_3', 'sch-1', 'pcb-1'),
		/title block still advertises board Board1/,
	);
});

test('verifyPcbImportTarget confirms a coherent linked board and schematic for pcb import', () => {
	const result = verifyPcbImportTarget(
		[
			{
				name: 'Board1_1',
				schematic: {
					uuid: 'sch-1',
					page: [{ titleBlockData: { '@Board Name': { value: 'Board1_1' } } }],
				},
			},
		],
		[{ uuid: 'pcb-1', parentBoardName: 'Board1_1' }],
		'pcb-1',
	);

	assert.equal(result.parentBoardName, 'Board1_1');
	assert.equal(result.schematicUuid, 'sch-1');
	assert.equal(result.titleBlockBoardName, 'Board1_1');
	assert.equal(result.readbackVerified, true);
});

test('verifyPcbImportTarget fails when the pcb belongs to a board without a linked schematic', () => {
	assert.throws(
		() => verifyPcbImportTarget(
			[{ name: 'Board1' }],
			[{ uuid: 'pcb-1', parentBoardName: 'Board1' }],
			'pcb-1',
		),
		/board Board1 has no linked schematic/,
	);
});

test('verifyPcbImportTarget fails when the linked schematic title block still points at a different board', () => {
	assert.throws(
		() => verifyPcbImportTarget(
			[
				{
					name: 'Board1_1',
					schematic: {
						uuid: 'sch-1',
						page: [{ titleBlockData: { '@Board Name': { value: 'Board1' } } }],
					},
				},
			],
			[{ uuid: 'pcb-1', parentBoardName: 'Board1_1' }],
			'pcb-1',
		),
		/title block still advertises board Board1/,
	);
});

test('getPcbImportTargetSnapshot captures the linked schematic page uuid for fallback source reads', () => {
	const snapshot = getPcbImportTargetSnapshot(
		[
			{
				name: 'Board1_2',
				schematic: {
					uuid: 'sch-2',
					page: [{ uuid: 'page-2', titleBlockData: { '@Board Name': { value: 'Board1_1' } } }],
				},
			},
		],
		[{ uuid: 'pcb-2', parentBoardName: 'Board1_2' }],
		'pcb-2',
	);

	assert.deepEqual(snapshot, {
		boardFound: true,
		pcbFound: true,
		parentBoardName: 'Board1_2',
		schematicPageUuid: 'page-2',
		schematicUuid: 'sch-2',
		titleBlockBoardName: 'Board1_1',
	});
});

test('getSchematicTitleBlockAttributeFromSource reads title block attributes from schematic source lines', () => {
	const source = [
		'["DOCTYPE","SCH","1.1"]',
		'["ATTR","e28","e1","@Board Name","Board1_2",0,0,null,null,0,"st4",0]',
		'["ATTR","e7","e1","@Schematic Name","Schematic1_1",null,null,null,null,null,"st1",0]',
	].join('\n');

	assert.equal(getSchematicTitleBlockAttributeFromSource(source, '@Board Name'), 'Board1_2');
	assert.equal(getSchematicTitleBlockAttributeFromSource(source, '@Schematic Name'), 'Schematic1_1');
	assert.equal(getSchematicTitleBlockAttributeFromSource(source, 'Missing'), undefined);
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

test('buildEmptyPcbImportCompareMapFromSchematicNetlist converts schematic netlist JSON into add-component compare entries', () => {
	const compareMap = buildEmptyPcbImportCompareMapFromSchematicNetlist(JSON.stringify({
		gge101: {
			props: {
				'Designator': 'U1',
				'Device': 'device-1',
				'Footprint': 'footprint-1',
				'Unique ID': 'gge101',
			},
			pins: {
				1: 'GND',
				24: 'BLINK',
			},
		},
		gge102: {
			props: {
				Designator: 'R1',
				Device: 'device-2',
				Footprint: 'footprint-2',
			},
			pins: {
				1: 'BLINK',
				2: 'LED_SERIES',
			},
		},
	}));

	assert.deepEqual(compareMap, {
		gge101: {
			addComponent: {
				uniqueId: 'gge101',
				props: {
					'Designator': 'U1',
					'Device': 'device-1',
					'Footprint': 'footprint-1',
					'Unique ID': 'gge101',
				},
				nets: {
					1: 'GND',
					24: 'BLINK',
				},
				extra: {
					bindingLibs: {
						device: {
							uuid: 'device-1',
							isProLib: true,
						},
						footprint: {
							uuid: 'footprint-1',
							isProLib: true,
						},
					},
				},
			},
		},
		gge102: {
			addComponent: {
				uniqueId: 'gge102',
				props: {
					Designator: 'R1',
					Device: 'device-2',
					Footprint: 'footprint-2',
				},
				nets: {
					1: 'BLINK',
					2: 'LED_SERIES',
				},
				extra: {
					bindingLibs: {
						device: {
							uuid: 'device-2',
							isProLib: true,
						},
						footprint: {
							uuid: 'footprint-2',
							isProLib: true,
						},
					},
				},
			},
		},
	});
});

test('buildEmptyPcbImportCompareMapFromSchematicNetlist rejects invalid JSON payloads', () => {
	assert.throws(
		() => buildEmptyPcbImportCompareMapFromSchematicNetlist('not-json'),
		/Could not parse EasyEDA schematic netlist JSON/,
	);
});

test('getOpenDocumentBootstrapFailure reports a fast-fail error for tab_page1 bootstrap shells', () => {
	const message = getOpenDocumentBootstrapFailure({
		currentDocument: {
			documentType: -1,
			uuid: 'tab_page1',
		},
		editorBootstrapState: {
			startPageOnly: true,
			requestedProjectUuid: 'project-1',
			requestedTabIds: ['*pcb-1@project-1'],
			suspectedBootstrapFailure: true,
		},
	}, 'pcb-1');

	assert.match(message ?? '', /open_document cannot proceed because EasyEDA is still stuck on Start Page/);
	assert.match(message ?? '', /project project-1/);
	assert.match(message ?? '', /Requested document pcb-1/);
	assert.match(message ?? '', /call get_current_context again before retrying open_document/);
});

test('getOpenDocumentBootstrapFailure stays silent for healthy editor contexts', () => {
	assert.equal(getOpenDocumentBootstrapFailure({
		currentDocument: {
			documentType: 4,
			uuid: 'pcb-1',
		},
		editorBootstrapState: {
			startPageOnly: false,
			suspectedBootstrapFailure: false,
		},
	}, 'pcb-1'), undefined);
});

test('describeEditorBootstrapState flags project-targeted start page shells as bootstrap failures', () => {
	assert.deepEqual(
		describeEditorBootstrapState(
			{ uuid: 'tab_page1' },
			{ tabs: [{ tabId: 'tab_page1' }] },
			'#id=project-1,tab=*pcb-1@project-1|sch-1@project-1',
		),
		{
			startPageOnly: true,
			urlHash: '#id=project-1,tab=*pcb-1@project-1|sch-1@project-1',
			requestedProjectUuid: 'project-1',
			requestedTabIds: ['*pcb-1@project-1', 'sch-1@project-1'],
			suspectedBootstrapFailure: true,
			warning: 'EasyEDA is still showing only Start Page even though the URL targets a project or document. Project bootstrap likely failed in this session.',
		},
	);
});
