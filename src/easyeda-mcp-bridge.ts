import type { BridgeHeaderMenuDocumentLike } from './bridge-header-menus';
import type { BridgeMethod, BridgeRequestEnvelope } from './mcp-bridge-protocol';
import type { PcbSourceSummary } from './project-readback-guards';

import { shouldSyncBridgeHeaderMenus, syncBridgeHeaderMenus } from './bridge-header-menus';
import { getSchematicNetLabelCapabilitySummary } from './bridge-runtime-capabilities';
import { allocateBridgeSocketId, shouldHandleBridgeSocketCallback } from './bridge-socket-lifecycle';
import { describeEditorBootstrapState, getOpenDocumentBootstrapFailure, getRuntimeLocationHash, inferCurrentDocumentFromEditorShell } from './editor-bootstrap-state';
import { EXTENSION_VERSION } from './extension-metadata';
import { withHostMethodTimeout } from './host-method-timeout';
import {
	computeSourceRevision,
	createBridgeError,
	createBridgeResponse,
	createExtensionHello,
	DEFAULT_BRIDGE_ENDPOINT,
	MCP_BRIDGE_CONFIG_KEY,
	MCP_BRIDGE_SOCKET_ID,
	parseBridgeEnvelope,
	serializeBridgeEnvelope,
} from './mcp-bridge-protocol';
import { normalizePcbLineLayerForHost } from './pcb-layer';
import { getOptionalTrimmedStringIncludingEmpty, resolvePcbLineNetForCreate } from './pcb-line-net';
import { findResolvedPcbPad } from './pcb-pad-geometry';
import { buildPcbPolylineSource } from './pcb-polyline';
import { findAddedPrimitiveIds } from './primitive-id-diff';
import {
	getImportReadbackStatus,
	getPcbImportTargetSnapshot,
	getSchematicTitleBlockAttributeFromSource,
	verifyCreatedBoard,
	verifyCreatedPcb,
	verifyPcbImportTarget,
} from './project-readback-guards';
import { buildSchematicPinStubLine } from './schematic-pin-stub';

interface BridgeState {
	endpoint: string;
	started: boolean;
	connected: boolean;
	connectAttempts: number;
	socketId?: string;
	lastAttemptAt?: number;
	lastConnectedAt?: number;
	lastError?: string;
	lastEvent?: string;
	serverInfo?: Record<string, unknown>;
}

const MCP_BRIDGE_RUNTIME_STATE_KEY = `${MCP_BRIDGE_CONFIG_KEY}:runtime-state`;

const bridgeState: BridgeState = {
	endpoint: DEFAULT_BRIDGE_ENDPOINT,
	started: false,
	connected: false,
	connectAttempts: 0,
};

let pendingConnectionDiagnosticTimer: NodeJS.Timeout | undefined;
let bridgeRuntimeStarted = false;
let bridgeSocketSequence = 0;

const PCB_TEXT_HOST_TIMEOUT_MS = 4_000;
const PCB_TEXT_HOST_TIMEOUT_HINT = 'This EasyEDA host session is not responding to pcb_PrimitiveString APIs. PCB text tools are unavailable in this session. Try reopening the PCB document or restarting the EasyEDA extension host.';
const BRIDGE_WATCHDOG_INTERVAL_MS = 5_000;
const BRIDGE_WATCHDOG_RECONNECT_COOLDOWN_MS = 5_000;

let bridgeWatchdogTimer: NodeJS.Timeout | undefined;
let bridgeWatchdogInFlight = false;
let bridgeWatchdogLastReconnectAt = 0;

export async function startEasyedaMcpBridge(forceReconnect = false): Promise<void> {
	hydratePersistedBridgeState();
	bridgeState.endpoint = getBridgeEndpoint();
	ensureBridgeWatchdog();
	await ensureBridgeHeaderMenus();
	if (bridgeRuntimeStarted && !forceReconnect)
		return;

	const previousSocketId = bridgeState.socketId;
	let nextSocket = allocateBridgeSocketId(MCP_BRIDGE_SOCKET_ID, bridgeSocketSequence);
	bridgeSocketSequence = nextSocket.nextSequence;
	if (previousSocketId && nextSocket.socketId === previousSocketId) {
		nextSocket = allocateBridgeSocketId(MCP_BRIDGE_SOCKET_ID, bridgeSocketSequence);
		bridgeSocketSequence = nextSocket.nextSequence;
	}

	const socketId = nextSocket.socketId;

	bridgeRuntimeStarted = true;
	bridgeState.started = true;
	bridgeState.connected = false;
	bridgeState.connectAttempts += 1;
	bridgeState.socketId = socketId;
	bridgeState.lastAttemptAt = Date.now();
	bridgeState.lastEvent = forceReconnect
		? `reconnecting websocket client with ${socketId}`
		: `registering websocket client ${socketId}`;
	bridgeState.lastError = undefined;
	void persistBridgeState();
	clearPendingConnectionDiagnosticTimer();

	if (previousSocketId) {
		try {
			eda.sys_WebSocket.close(previousSocketId);
			bridgeState.lastEvent = previousSocketId === socketId
				? `closed stale websocket ${previousSocketId} before retrying with a new id`
				: `closed previous websocket ${previousSocketId} before registering ${socketId}`;
			void persistBridgeState();
		}
		catch {
			// Ignore close errors when reconnecting.
		}
	}

	try {
		eda.sys_WebSocket.register(
			socketId,
			bridgeState.endpoint,
			async (event) => {
				if (!shouldHandleBridgeSocketCallback(bridgeState.socketId, socketId))
					return;

				const rawMessage = typeof event.data === 'string' ? event.data : undefined;
				if (!rawMessage)
					return;

				bridgeState.lastEvent = 'received websocket message';
				await handleSocketMessage(rawMessage);
			},
			async () => {
				if (!shouldHandleBridgeSocketCallback(bridgeState.socketId, socketId))
					return;

				clearPendingConnectionDiagnosticTimer();
				bridgeState.connected = true;
				bridgeState.lastConnectedAt = Date.now();
				bridgeState.lastEvent = 'websocket connected';
				bridgeState.lastError = undefined;
				void persistBridgeState();
				sendSocketMessage(createExtensionHello(await getHelloPayload()), socketId);
			},
		);
		scheduleConnectionDiagnostic(socketId);
	}
	catch (error: unknown) {
		bridgeState.connected = false;
		bridgeState.lastError = toErrorMessage(error);
		bridgeState.lastEvent = 'websocket registration threw';
		void persistBridgeState();
		logInfo(`MCP bridge failed to start: ${bridgeState.lastError}`);
	}
}

export async function reconnectEasyedaMcpBridge(): Promise<void> {
	await startEasyedaMcpBridge(true);
}

export function shouldAttemptBridgeWatchdogReconnect(
	state: Pick<BridgeState, 'started' | 'connected' | 'lastAttemptAt'>,
	currentDocument?: BridgeHeaderMenuDocumentLike | null,
	now = Date.now(),
	lastWatchdogReconnectAt = 0,
): boolean {
	const bridgeMenuMissing = shouldSyncBridgeHeaderMenus(currentDocument);
	if (!state.started)
		return bridgeMenuMissing;

	if (!bridgeMenuMissing && state.connected)
		return false;

	const lastReconnectAttemptAt = Math.max(
		typeof state.lastAttemptAt === 'number' ? state.lastAttemptAt : 0,
		lastWatchdogReconnectAt,
	);
	return now - lastReconnectAttemptAt >= BRIDGE_WATCHDOG_RECONNECT_COOLDOWN_MS;
}

export async function probeEasyedaMcpBridge(): Promise<void> {
	await reconnectEasyedaMcpBridge();
	setTimeout(() => {
		showBridgeStatus();
	}, 3500);
	eda.sys_Dialog.showInformationMessage('Reconnecting to the MCP bridge. Status will refresh in a moment.', 'MCP Bridge Probe');
}

export function getEasyedaMcpBridgeState(): BridgeState {
	hydratePersistedBridgeState();
	bridgeState.endpoint = getBridgeEndpoint();
	return { ...bridgeState };
}

export function shouldUseHostUiImportFallback(
	hostImported: boolean,
	readbackVerified: boolean,
	beforeSummary: Pick<PcbSourceSummary, 'componentCount'>,
	afterSummary: Pick<PcbSourceSummary, 'componentCount'>,
): boolean {
	return hostImported && !readbackVerified && beforeSummary.componentCount === 0 && afterSummary.componentCount === 0;
}

export async function configureEasyedaMcpBridge(): Promise<void> {
	eda.sys_Dialog.showInputDialog(
		'WebSocket endpoint for the MCP bridge',
		`Current: ${bridgeState.endpoint}`,
		'Configure MCP Bridge',
		'text',
		bridgeState.endpoint,
		{
			placeholder: DEFAULT_BRIDGE_ENDPOINT,
		},
		async (value) => {
			if (typeof value !== 'string' || !value.trim())
				return;

			const endpoint = value.trim();
			await eda.sys_Storage.setExtensionUserConfig(MCP_BRIDGE_CONFIG_KEY, endpoint);
			bridgeState.endpoint = endpoint;
			void persistBridgeState();
			await reconnectEasyedaMcpBridge();
			showBridgeStatus();
		},
	);
}

export function showBridgeStatus(): void {
	hydratePersistedBridgeState();
	bridgeState.endpoint = getBridgeEndpoint();
	const state = getEasyedaMcpBridgeState();
	const lines = [
		`Version: ${EXTENSION_VERSION}`,
		`Endpoint: ${state.endpoint}`,
		`Socket id: ${state.socketId ?? 'none'}`,
		`Started: ${String(state.started)}`,
		`Connected: ${String(state.connected)}`,
		`Connect attempts: ${String(state.connectAttempts)}`,
		`Last attempt: ${state.lastAttemptAt ? new Date(state.lastAttemptAt).toISOString() : 'never'}`,
		`Last connected: ${state.lastConnectedAt ? new Date(state.lastConnectedAt).toISOString() : 'never'}`,
		`Last event: ${state.lastEvent ?? 'none'}`,
		`Last error: ${state.lastError ?? 'none'}`,
	];

	eda.sys_Dialog.showInformationMessage(lines.join('\n'), 'MCP Bridge Status');
}

async function ensureBridgeHeaderMenus(): Promise<void> {
	try {
		await syncBridgeHeaderMenus(eda.sys_HeaderMenu);
	}
	catch (error: unknown) {
		logInfo(`MCP bridge header menu sync failed: ${toErrorMessage(error)}`);
	}
}

function ensureBridgeWatchdog(): void {
	if (bridgeWatchdogTimer)
		return;

	bridgeWatchdogTimer = setInterval(() => {
		void runBridgeWatchdog();
	}, BRIDGE_WATCHDOG_INTERVAL_MS);
}

async function runBridgeWatchdog(): Promise<void> {
	if (bridgeWatchdogInFlight)
		return;

	bridgeWatchdogInFlight = true;
	try {
		const bridgeMenuMissing = shouldSyncBridgeHeaderMenus(globalThis.document);
		if (bridgeMenuMissing)
			await ensureBridgeHeaderMenus();

		if (!shouldAttemptBridgeWatchdogReconnect(bridgeState, globalThis.document, Date.now(), bridgeWatchdogLastReconnectAt))
			return;

		bridgeWatchdogLastReconnectAt = Date.now();
		await startEasyedaMcpBridge(true);
	}
	catch (error: unknown) {
		logInfo(`MCP bridge watchdog recovery failed: ${toErrorMessage(error)}`);
	}
	finally {
		bridgeWatchdogInFlight = false;
	}
}

async function handleSocketMessage(rawMessage: string): Promise<void> {
	const envelope = parseBridgeEnvelope(rawMessage);
	if (!envelope)
		return;

	if (envelope.type === 'hello') {
		bridgeState.serverInfo = envelope.payload;
		bridgeState.lastEvent = 'received server hello';
		void persistBridgeState();
		return;
	}

	if (envelope.type !== 'request')
		return;

	const response = await executeRequest(envelope);
	sendSocketMessage(response);
}

async function executeRequest(envelope: BridgeRequestEnvelope) {
	try {
		const result = await dispatchMethod(envelope.method, envelope.params ?? {});
		return createBridgeResponse(envelope.requestId, result);
	}
	catch (error: unknown) {
		return createBridgeError(envelope.requestId, 'bridge_request_failed', toErrorMessage(error));
	}
}

async function dispatchMethod(method: BridgeMethod, params: Record<string, unknown>): Promise<unknown> {
	switch (method) {
		case 'get_capabilities':
			return getCapabilities();
		case 'ping_bridge':
			return pingBridge();
		case 'echo_bridge':
			return echoBridge(params);
		case 'search_library_devices':
			return searchLibraryDevices(params);
		case 'get_current_context':
			return getCurrentContext();
		case 'list_project_objects':
			return listProjectObjects();
		case 'open_document':
			return openDocument(params);
		case 'save_active_document':
			return saveActiveDocument();
		case 'create_board':
			return createBoard(params);
		case 'create_pcb':
			return createPcb(params);
		case 'import_schematic_to_pcb':
			return importSchematicToPcb(params);
		case 'create_panel':
			return createPanel();
		case 'create_schematic':
			return createSchematic(params);
		case 'create_schematic_page':
			return createSchematicPage(params);
		case 'copy_board':
			return copyBoard(params);
		case 'copy_pcb':
			return copyPcb(params);
		case 'copy_panel':
			return copyPanel(params);
		case 'copy_schematic':
			return copySchematic(params);
		case 'copy_schematic_page':
			return copySchematicPage(params);
		case 'add_schematic_component':
			return addSchematicComponent(params);
		case 'modify_schematic_component':
			return modifySchematicComponent(params);
		case 'delete_schematic_component':
			return deleteSchematicComponent(params);
		case 'add_schematic_net_flag':
			return addSchematicNetFlag(params);
		case 'add_schematic_net_port':
			return addSchematicNetPort(params);
		case 'add_schematic_short_circuit_flag':
			return addSchematicShortCircuitFlag(params);
		case 'list_schematic_component_pins':
			return listSchematicComponentPins(params);
		case 'set_schematic_pin_no_connect':
			return setSchematicPinNoConnect(params);
		case 'connect_schematic_pin_to_net':
			return connectSchematicPinToNet(params);
		case 'connect_schematic_pins_to_nets':
			return connectSchematicPinsToNets(params);
		case 'connect_schematic_pins_with_prefix':
			return connectSchematicPinsWithPrefix(params);
		case 'add_schematic_text':
			return addSchematicText(params);
		case 'add_schematic_net_label':
			return addSchematicNetLabel(params);
		case 'add_schematic_wire':
			return addSchematicWire(params);
		case 'list_schematic_primitive_ids':
			return listSchematicPrimitiveIds(params);
		case 'get_schematic_primitive':
			return getSchematicPrimitive(params);
		case 'get_schematic_primitives_bbox':
			return getSchematicPrimitivesBBox(params);
		case 'add_pcb_component':
			return addPcbComponent(params);
		case 'modify_pcb_component':
			return modifyPcbComponent(params);
		case 'delete_pcb_component':
			return deletePcbComponent(params);
		case 'list_pcb_component_pads':
			return listPcbComponentPads(params);
		case 'route_pcb_line_between_component_pads':
			return routePcbLineBetweenComponentPads(params);
		case 'route_pcb_lines_between_component_pads':
			return routePcbLinesBetweenComponentPads(params);
		case 'add_pcb_line':
			return addPcbLine(params);
		case 'add_pcb_text':
			return addPcbText(params);
		case 'list_pcb_primitive_ids':
			return listPcbPrimitiveIds(params);
		case 'get_pcb_primitive':
			return getPcbPrimitive(params);
		case 'get_pcb_primitives_bbox':
			return getPcbPrimitivesBBox(params);
		case 'list_pcb_nets':
			return listPcbNets();
		case 'get_pcb_net':
			return getPcbNet(params);
		case 'set_pcb_net_color':
			return setPcbNetColor(params);
		case 'get_pcb_net_primitives':
			return getPcbNetPrimitives(params);
		case 'modify_schematic_text':
			return modifySchematicText(params);
		case 'delete_schematic_text':
			return deleteSchematicText(params);
		case 'modify_schematic_net_label':
			return modifySchematicNetLabel(params);
		case 'modify_schematic_wire':
			return modifySchematicWire(params);
		case 'delete_schematic_wire':
			return deleteSchematicWire(params);
		case 'modify_pcb_line':
			return modifyPcbLine(params);
		case 'delete_pcb_line':
			return deletePcbLine(params);
		case 'modify_pcb_text':
			return modifyPcbText(params);
		case 'delete_pcb_text':
			return deletePcbText(params);
		case 'rename_board':
			return renameBoard(params);
		case 'rename_pcb':
			return renamePcb(params);
		case 'rename_schematic':
			return renameSchematic(params);
		case 'rename_schematic_page':
			return renameSchematicPage(params);
		case 'rename_panel':
			return renamePanel(params);
		case 'delete_board':
			return deleteBoard(params);
		case 'delete_pcb':
			return deletePcb(params);
		case 'delete_schematic':
			return deleteSchematic(params);
		case 'delete_schematic_page':
			return deleteSchematicPage(params);
		case 'delete_panel':
			return deletePanel(params);
		case 'get_document_source':
			return getDocumentSource();
		case 'set_document_source':
			return setDocumentSource(params);
		default:
			throw new Error(`Unsupported bridge method: ${method satisfies never}`);
	}
}

async function getHelloPayload(): Promise<Record<string, unknown>> {
	return {
		extensionVersion: EXTENSION_VERSION,
		endpoint: bridgeState.endpoint,
		methods: getSupportedMethods(),
	};
}

function getCapabilities(): Record<string, unknown> {
	const allBridgeMethods = getSupportedMethods();
	const schematicNetLabelCapability = getSchematicNetLabelCapabilitySummary(getSchematicAttributeApiIfAvailable());
	const hostRuntimeUnsupportedMethods = schematicNetLabelCapability.unsupportedMethods as BridgeMethod[];
	const supportedMethods = allBridgeMethods.filter(method => !hostRuntimeUnsupportedMethods.includes(method));

	return {
		bridgeEndpoint: bridgeState.endpoint,
		connected: bridgeState.connected,
		supportedMethods,
		allBridgeMethods,
		hostRuntimeUnsupportedMethods,
		hostRuntimeCapabilities: {
			schematicNetLabel: schematicNetLabelCapability,
		},
		requiresExternalInteractionPermission: true,
	};
}

function pingBridge(): Record<string, unknown> {
	return {
		method: 'ping_bridge',
		ok: true,
		pong: true,
		timestamp: new Date().toISOString(),
		connected: bridgeState.connected,
	};
}

function echoBridge(params: Record<string, unknown>): Record<string, unknown> {
	const message = typeof params.message === 'string' ? params.message : '';
	return {
		method: 'echo_bridge',
		ok: true,
		message,
		timestamp: new Date().toISOString(),
		connected: bridgeState.connected,
	};
}

async function getCurrentContext(): Promise<Record<string, unknown>> {
	const [hostCurrentDocument, hostCurrentProject] = await Promise.all([
		eda.dmt_SelectControl.getCurrentDocumentInfo(),
		eda.dmt_Project.getCurrentProjectInfo(),
	]);
	const splitScreenTree = await eda.dmt_EditorControl.getSplitScreenTree();
	const shellWindow = getAccessibleEditorShellWindow();
	const editorShellHash = getRuntimeLocationHash(shellWindow?.location) || getRuntimeLocationHash(location);
	const currentDocument = inferCurrentDocumentFromEditorShell(
		hostCurrentDocument,
		editorShellHash,
		getEditorShellIframes(shellWindow?.document),
	) ?? hostCurrentDocument;
	const currentProject = hostCurrentProject ?? inferCurrentProjectFromShell(editorShellHash);
	const editorBootstrapState = describeEditorBootstrapState(currentDocument, splitScreenTree, editorShellHash);

	return {
		currentDocument,
		currentProject,
		splitScreenTree,
		editorBootstrapState,
	};
}

async function searchLibraryDevices(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const query = getOptionalString(params.query);
	const lcscIds = getOptionalStringArray(params.lcscIds);
	const libraryUuid = getOptionalString(params.libraryUuid);
	const itemsPerPage = getOptionalNumber(params.itemsPerPage);
	const page = getOptionalNumber(params.page);
	const allowMultiMatch = getOptionalBoolean(params.allowMultiMatch);

	if (!query && !lcscIds?.length)
		throw new Error('query or lcscIds is required for library device search');

	const devices = lcscIds?.length
		? await eda.lib_Device.getByLcscIds(lcscIds, libraryUuid, allowMultiMatch)
		: await eda.lib_Device.search(query!, libraryUuid, undefined, undefined, itemsPerPage, page);

	return {
		query,
		lcscIds,
		libraryUuid,
		count: devices.length,
		devices,
	};
}

async function listProjectObjects(): Promise<Record<string, unknown>> {
	const [boards, pcbs, schematics, schematicPages, panels] = await Promise.all([
		eda.dmt_Board.getAllBoardsInfo(),
		eda.dmt_Pcb.getAllPcbsInfo(),
		eda.dmt_Schematic.getAllSchematicsInfo(),
		eda.dmt_Schematic.getAllSchematicPagesInfo(),
		eda.dmt_Panel.getAllPanelsInfo(),
	]);

	return {
		boards,
		pcbs,
		schematics,
		schematicPages,
		panels,
	};
}

async function openDocument(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const documentUuid = getRequiredString(params.documentUuid, 'documentUuid');
	const splitScreenId = getOptionalString(params.splitScreenId);
	const currentContext = await getCurrentContext();
	const bootstrapFailureMessage = getOpenDocumentBootstrapFailure(currentContext, documentUuid);
	if (bootstrapFailureMessage)
		throw new Error(bootstrapFailureMessage);
	const tabId = await eda.dmt_EditorControl.openDocument(documentUuid, splitScreenId);

	return {
		tabId,
		documentUuid,
	};
}

async function saveActiveDocument(): Promise<Record<string, unknown>> {
	const currentDocument = await requireCurrentDocument();

	switch (currentDocument.documentType) {
		case EDMT_EditorDocumentType.SCHEMATIC_PAGE:
			return {
				currentDocument,
				saved: await eda.sch_Document.save(),
			};
		case EDMT_EditorDocumentType.PCB:
			return {
				currentDocument,
				saved: await eda.pcb_Document.save(currentDocument.uuid),
			};
		case EDMT_EditorDocumentType.PANEL:
			return {
				currentDocument,
				saved: await eda.pnl_Document.save(),
			};
		default:
			throw new Error('The active document is not a schematic page, PCB, or panel and cannot be saved by this tool');
	}
}

async function createPcb(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const boardName = getOptionalString(params.boardName);
	const pcbUuid = await eda.dmt_Pcb.createPcb(boardName);
	const projectInventory = await getVerifiedProjectInventory();
	const { parentBoardName, readbackVerified } = verifyCreatedPcb(projectInventory.pcbs, pcbUuid, boardName);

	return {
		pcbUuid,
		boardName,
		parentBoardName,
		readbackVerified,
	};
}

async function createBoard(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const schematicUuid = getOptionalString(params.schematicUuid);
	const pcbUuid = getOptionalString(params.pcbUuid);
	const boardName = await eda.dmt_Board.createBoard(schematicUuid, pcbUuid);
	const projectInventory = await getVerifiedProjectInventory();
	const { actualSchematicUuid, actualPcbUuid, readbackVerified } = verifyCreatedBoard(
		projectInventory.boards,
		boardName,
		schematicUuid,
		pcbUuid,
	);

	return {
		boardName,
		schematicUuid,
		pcbUuid,
		actualSchematicUuid,
		actualPcbUuid,
		readbackVerified,
	};
}

async function importSchematicToPcb(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const pcbUuid = getRequiredString(params.pcbUuid, 'pcbUuid');
	const saveAfter = getOptionalBoolean(params.saveAfter);
	const allowEmptyResult = getOptionalBoolean(params.allowEmptyResult) === true;
	const projectInventory = await getVerifiedProjectInventory();
	const {
		parentBoardName,
		schematicUuid,
		titleBlockBoardName,
		inventoryTitleBlockBoardName,
		sourceTitleBlockBoardName,
		readbackVerified: importTargetReadbackVerified,
		sourceFallbackUsed: importTargetSourceFallbackUsed,
	} = await resolvePcbImportTargetReadback(projectInventory, pcbUuid);
	await openPcbDocumentIfNeeded(pcbUuid);
	const beforeSource = (await eda.sys_FileManager.getDocumentSource()) ?? '';
	const hostImported = await eda.pcb_Document.importChanges(pcbUuid);
	let saved = await savePcbDocumentIfRequested(pcbUuid, saveAfter);
	let afterSource = (await eda.sys_FileManager.getDocumentSource()) ?? '';
	let { beforeSummary, afterSummary, sourceChanged, readbackVerified } = getImportReadbackStatus(
		beforeSource,
		afterSource,
		allowEmptyResult,
	);
	let emptyPcbHostUiFallbackUsed = false;

	if (shouldUseHostUiImportFallback(hostImported, readbackVerified, beforeSummary, afterSummary)) {
		const fallbackImported = await importEmptyPcbFromHostUi(pcbUuid);
		if (fallbackImported) {
			emptyPcbHostUiFallbackUsed = true;
			saved = await savePcbDocumentIfRequested(pcbUuid, saveAfter);
			afterSource = (await eda.sys_FileManager.getDocumentSource()) ?? '';
			({ beforeSummary, afterSummary, sourceChanged, readbackVerified } = getImportReadbackStatus(
				beforeSource,
				afterSource,
				allowEmptyResult,
			));
		}
	}

	if (hostImported && !readbackVerified) {
		throw new Error(
			`EasyEDA reported schematic import success for PCB ${pcbUuid}, but readback stayed empty and unchanged even though PCB ${pcbUuid} is linked to board ${parentBoardName} and schematic ${schematicUuid}. The host ignored pcb_Document.importChanges(${pcbUuid}), and the empty-PCB host-UI fallback did not populate the target.`,
		);
	}

	return {
		pcbUuid,
		parentBoardName,
		schematicUuid,
		titleBlockBoardName,
		inventoryTitleBlockBoardName,
		sourceTitleBlockBoardName,
		importTargetReadbackVerified,
		importTargetSourceFallbackUsed,
		imported: hostImported,
		emptyPcbHostUiFallbackUsed,
		saved,
		allowEmptyResult,
		sourceChanged,
		readbackVerified,
		beforeSummary,
		afterSummary,
	};
}

async function resolvePcbImportTargetReadback(
	projectInventory: ProjectInventory,
	pcbUuid: string,
): Promise<{
	parentBoardName: string;
	schematicUuid: string;
	schematicPageUuid: string;
	titleBlockBoardName?: string;
	inventoryTitleBlockBoardName?: string;
	sourceTitleBlockBoardName?: string;
	readbackVerified: true;
	sourceFallbackUsed: boolean;
}> {
	const snapshot = getPcbImportTargetSnapshot(projectInventory.boards, projectInventory.pcbs, pcbUuid);

	try {
		const verified = verifyPcbImportTarget(projectInventory.boards, projectInventory.pcbs, pcbUuid);
		if (!snapshot.schematicPageUuid)
			throw new Error(`import_schematic_to_pcb requires board ${verified.parentBoardName} to expose a linked schematic page for readback`);

		return {
			...verified,
			schematicPageUuid: snapshot.schematicPageUuid,
			inventoryTitleBlockBoardName: verified.titleBlockBoardName,
			sourceFallbackUsed: false,
		};
	}
	catch (error: unknown) {
		const parentBoardName = snapshot.parentBoardName;
		const schematicUuid = snapshot.schematicUuid;
		const schematicPageUuid = snapshot.schematicPageUuid;
		const inventoryTitleBlockBoardName = snapshot.titleBlockBoardName;
		if (!parentBoardName || !schematicUuid || !schematicPageUuid || !inventoryTitleBlockBoardName || inventoryTitleBlockBoardName === parentBoardName)
			throw error;

		const sourceTitleBlockBoardName = await getSchematicPageTitleBlockAttribute(schematicPageUuid, '@Board Name');
		if (!sourceTitleBlockBoardName || sourceTitleBlockBoardName !== parentBoardName)
			throw error;

		return {
			parentBoardName,
			schematicUuid,
			schematicPageUuid,
			titleBlockBoardName: sourceTitleBlockBoardName,
			inventoryTitleBlockBoardName,
			sourceTitleBlockBoardName,
			readbackVerified: true,
			sourceFallbackUsed: true,
		};
	}
}

async function createPanel(): Promise<Record<string, unknown>> {
	const panelUuid = await eda.dmt_Panel.createPanel();

	return {
		panelUuid,
	};
}

async function createSchematic(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const boardName = getOptionalString(params.boardName);
	const schematicUuid = await eda.dmt_Schematic.createSchematic(boardName);

	return {
		schematicUuid,
		boardName,
	};
}

async function createSchematicPage(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const schematicUuid = getRequiredString(params.schematicUuid, 'schematicUuid');
	const schematicPageUuid = await eda.dmt_Schematic.createSchematicPage(schematicUuid);

	return {
		schematicUuid,
		schematicPageUuid,
	};
}

async function copyBoard(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const sourceBoardName = getRequiredString(params.sourceBoardName, 'sourceBoardName');
	const boardName = await eda.dmt_Board.copyBoard(sourceBoardName);

	return {
		sourceBoardName,
		boardName,
	};
}

async function copyPcb(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const pcbUuid = getRequiredString(params.pcbUuid, 'pcbUuid');
	const boardName = getOptionalString(params.boardName);
	const copiedPcbUuid = await eda.dmt_Pcb.copyPcb(pcbUuid, boardName);

	return {
		pcbUuid,
		boardName,
		copiedPcbUuid,
	};
}

async function copyPanel(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const panelUuid = getRequiredString(params.panelUuid, 'panelUuid');
	const copiedPanelUuid = await eda.dmt_Panel.copyPanel(panelUuid);

	return {
		panelUuid,
		copiedPanelUuid,
	};
}

async function copySchematic(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const schematicUuid = getRequiredString(params.schematicUuid, 'schematicUuid');
	const boardName = getOptionalString(params.boardName);
	const copiedSchematicUuid = await eda.dmt_Schematic.copySchematic(schematicUuid, boardName);

	return {
		schematicUuid,
		boardName,
		copiedSchematicUuid,
	};
}

async function copySchematicPage(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const schematicPageUuid = getRequiredString(params.schematicPageUuid, 'schematicPageUuid');
	const schematicUuid = getOptionalString(params.schematicUuid);
	const copiedSchematicPageUuid = await eda.dmt_Schematic.copySchematicPage(schematicPageUuid, schematicUuid);

	return {
		schematicPageUuid,
		schematicUuid,
		copiedSchematicPageUuid,
	};
}

async function addSchematicComponent(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic component placement');
	const primitive = await eda.sch_PrimitiveComponent.create(
		getRequiredDeviceReference(params),
		getRequiredNumber(params.x, 'x'),
		getRequiredNumber(params.y, 'y'),
		getOptionalString(params.subPartName),
		getOptionalNumber(params.rotation),
		getOptionalBoolean(params.mirror),
		getOptionalBoolean(params.addIntoBom),
		getOptionalBoolean(params.addIntoPcb),
	);
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		primitive,
		saved,
	};
}

async function modifySchematicComponent(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic component editing');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	const primitive = await eda.sch_PrimitiveComponent.modify(primitiveId, {
		x: getOptionalNumber(params.x),
		y: getOptionalNumber(params.y),
		rotation: getOptionalNumber(params.rotation),
		mirror: getOptionalBoolean(params.mirror),
		addIntoBom: getOptionalBoolean(params.addIntoBom),
		addIntoPcb: getOptionalBoolean(params.addIntoPcb),
		designator: getOptionalNullableString(params.designator),
		name: getOptionalNullableString(params.name),
		uniqueId: getOptionalNullableString(params.uniqueId),
		manufacturer: getOptionalNullableString(params.manufacturer),
		manufacturerId: getOptionalNullableString(params.manufacturerId),
		supplier: getOptionalNullableString(params.supplier),
		supplierId: getOptionalNullableString(params.supplierId),
		otherProperty: getOptionalScalarRecord(params.otherProperty),
	});
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		primitive,
		saved,
	};
}

async function deleteSchematicComponent(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic component deletion');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	await maybeConfirmDestructiveAction(params, 'Delete Schematic Component', `Delete schematic component primitive ${primitiveId}?`, 'Delete');
	const deleted = await eda.sch_PrimitiveComponent.delete(primitiveId);
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		deleted,
		saved,
	};
}

async function addSchematicNetFlag(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic net flags');
	const primitive = await eda.sch_PrimitiveComponent.createNetFlag(
		getRequiredString(params.identification, 'identification') as 'Power' | 'Ground' | 'AnalogGround' | 'ProtectGround',
		getRequiredString(params.net, 'net'),
		getRequiredNumber(params.x, 'x'),
		getRequiredNumber(params.y, 'y'),
		getOptionalNumber(params.rotation),
		getOptionalBoolean(params.mirror),
	);
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		primitive,
		saved,
	};
}

async function addSchematicNetPort(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic net ports');
	const primitive = await eda.sch_PrimitiveComponent.createNetPort(
		getRequiredString(params.direction, 'direction') as 'IN' | 'OUT' | 'BI',
		getRequiredString(params.net, 'net'),
		getRequiredNumber(params.x, 'x'),
		getRequiredNumber(params.y, 'y'),
		getOptionalNumber(params.rotation),
		getOptionalBoolean(params.mirror),
	);
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		primitive,
		saved,
	};
}

async function addSchematicShortCircuitFlag(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for short-circuit markers');
	const primitive = await eda.sch_PrimitiveComponent.createShortCircuitFlag(
		getRequiredNumber(params.x, 'x'),
		getRequiredNumber(params.y, 'y'),
		getOptionalNumber(params.rotation),
		getOptionalBoolean(params.mirror),
	);
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		primitive,
		saved,
	};
}

async function listSchematicComponentPins(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for component pin queries');
	const componentPrimitiveId = getRequiredString(params.componentPrimitiveId, 'componentPrimitiveId');
	const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(componentPrimitiveId) ?? [];

	return {
		componentPrimitiveId,
		count: pins.length,
		pins: pins.map(pin => serializeSchematicPin(pin)),
	};
}

async function setSchematicPinNoConnect(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic pin editing');
	const componentPrimitiveId = getRequiredString(params.componentPrimitiveId, 'componentPrimitiveId');
	const pinNumber = getRequiredString(params.pinNumber, 'pinNumber');
	const noConnected = getOptionalBoolean(params.noConnected);
	if (typeof noConnected !== 'boolean')
		throw new Error('Expected a boolean for noConnected');

	const pin = await requireSchematicPin(componentPrimitiveId, pinNumber);
	const updatedPin = await setSchematicPinNoConnected(pin, noConnected);
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		componentPrimitiveId,
		pin: serializeSchematicPin(updatedPin),
		saved,
	};
}

async function connectSchematicPinToNet(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic pin net attachment');
	const componentPrimitiveId = getRequiredString(params.componentPrimitiveId, 'componentPrimitiveId');
	const pinNumber = getRequiredString(params.pinNumber, 'pinNumber');
	const net = getRequiredString(params.net, 'net');
	const pin = await requireSchematicPin(componentPrimitiveId, pinNumber);
	const attachment = await createSchematicPinNetAttachment(pin, net, getOptionalNumber(params.labelOffsetX), getOptionalNumber(params.labelOffsetY));
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		componentPrimitiveId,
		pin: serializeSchematicPin(pin),
		net,
		primitive: attachment.primitive,
		attachmentKind: attachment.kind,
		fallbackUsed: attachment.fallbackUsed,
		saved,
	};
}

async function connectSchematicPinsToNets(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for bulk schematic net attachment');
	const componentPrimitiveId = getRequiredString(params.componentPrimitiveId, 'componentPrimitiveId');
	const connections = getRequiredObjectArray(params.connections, 'connections');
	const results: Array<Record<string, unknown>> = [];

	for (const connection of connections) {
		const pinNumber = getRequiredString(connection.pinNumber, 'connections.pinNumber');
		const net = getRequiredString(connection.net, 'connections.net');
		const pin = await requireSchematicPin(componentPrimitiveId, pinNumber);
		const attachment = await createSchematicPinNetAttachment(pin, net, getOptionalNumber(connection.labelOffsetX), getOptionalNumber(connection.labelOffsetY));
		results.push({
			pin: serializeSchematicPin(pin),
			net,
			primitive: attachment.primitive,
			attachmentKind: attachment.kind,
			fallbackUsed: attachment.fallbackUsed,
		});
	}

	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));
	return {
		componentPrimitiveId,
		count: results.length,
		connections: results,
		saved,
	};
}

async function connectSchematicPinsWithPrefix(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for prefix-based net attachment');
	const componentPrimitiveId = getRequiredString(params.componentPrimitiveId, 'componentPrimitiveId');
	const pinNumbers = getRequiredStringArray(params.pinNumbers, 'pinNumbers');
	const netPrefix = getRequiredString(params.netPrefix, 'netPrefix');
	const separator = getOptionalString(params.separator) ?? '_';
	const pinOffset = getOptionalNumber(params.pinOffset) ?? 0;
	const labelOffsetX = getOptionalNumber(params.labelOffsetX);
	const labelOffsetY = getOptionalNumber(params.labelOffsetY);
	const results: Array<Record<string, unknown>> = [];

	for (const pinNumber of pinNumbers) {
		const pin = await requireSchematicPin(componentPrimitiveId, pinNumber);
		const net = `${netPrefix}${separator}${buildShiftedPinLabel(pinNumber, pinOffset)}`;
		const attachment = await createSchematicPinNetAttachment(pin, net, labelOffsetX, labelOffsetY);
		results.push({
			pin: serializeSchematicPin(pin),
			net,
			primitive: attachment.primitive,
			attachmentKind: attachment.kind,
			fallbackUsed: attachment.fallbackUsed,
		});
	}

	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));
	return {
		componentPrimitiveId,
		netPrefix,
		separator,
		pinOffset,
		count: results.length,
		connections: results,
		saved,
	};
}

async function addSchematicText(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic text');
	const x = getRequiredNumber(params.x, 'x');
	const y = getRequiredNumber(params.y, 'y');
	const content = getRequiredString(params.content, 'content');
	const primitive = await eda.sch_PrimitiveText.create(
		x,
		y,
		content,
		getOptionalNumber(params.rotation),
		getOptionalNullableString(params.textColor),
		getOptionalNullableString(params.fontName),
		getOptionalNullableNumber(params.fontSize),
		getOptionalBoolean(params.bold),
		getOptionalBoolean(params.italic),
		getOptionalBoolean(params.underLine),
		getOptionalNumber(params.alignMode) as ESCH_PrimitiveTextAlignMode | undefined,
	);
	const saved = getOptionalBoolean(params.saveAfter) ? await eda.sch_Document.save() : undefined;

	return {
		primitive,
		saved,
	};
}

async function listSchematicPrimitiveIds(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic primitive queries');
	const family = getRequiredString(params.family, 'family');
	let primitiveIds: string[];

	switch (family) {
		case 'text':
			primitiveIds = await eda.sch_PrimitiveText.getAllPrimitiveId();
			break;
		case 'wire':
			primitiveIds = await eda.sch_PrimitiveWire.getAllPrimitiveId(getOptionalStringOrStringArray(params.net));
			break;
		case 'component':
			primitiveIds = await eda.sch_PrimitiveComponent.getAllPrimitiveId(
				getOptionalNumber(params.componentType) as ESCH_PrimitiveComponentType | undefined,
				getOptionalBoolean(params.allSchematicPages),
			);
			break;
		default:
			throw new Error(`Unsupported schematic primitive family: ${family}`);
	}

	return {
		family,
		count: primitiveIds.length,
		primitiveIds,
	};
}

async function getSchematicPrimitive(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic primitive queries');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	const primitive = await eda.sch_Primitive.getPrimitiveByPrimitiveId(primitiveId);

	return {
		primitiveId,
		primitive,
	};
}

async function getSchematicPrimitivesBBox(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic bounding-box queries');
	const primitiveIds = getRequiredStringArray(params.primitiveIds, 'primitiveIds');
	const bbox = await eda.sch_Primitive.getPrimitivesBBox(primitiveIds);

	return {
		primitiveIds,
		bbox,
	};
}

async function addPcbComponent(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const currentDocument = await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB component placement');
	const deviceReference = getRequiredDeviceReference(params);
	const layer = getRequiredString(params.layer, 'layer') as TPCB_LayersOfComponent;
	const x = getRequiredNumber(params.x, 'x');
	const y = getRequiredNumber(params.y, 'y');
	const rotation = getOptionalNumber(params.rotation);
	const primitiveLock = getOptionalBoolean(params.primitiveLock);
	const previousPrimitiveIds = await listRecoverablePcbComponentPrimitiveIds(layer, primitiveLock);
	let primitive: unknown;
	let recoveredFromError = false;
	let recoveryError: string | undefined;

	try {
		primitive = await eda.pcb_PrimitiveComponent.create(
			deviceReference,
			layer,
			x,
			y,
			rotation,
			primitiveLock,
		);
	}
	catch (error: unknown) {
		primitive = await recoverCreatedPcbComponentFromHostError(previousPrimitiveIds, layer, primitiveLock);
		if (!primitive)
			throw error;

		recoveredFromError = true;
		recoveryError = toErrorMessage(error);
	}

	const saved = await savePcbDocumentIfRequested(currentDocument.uuid, getOptionalBoolean(params.saveAfter));

	return {
		primitive,
		recoveredFromError,
		recoveryError,
		saved,
	};
}

async function modifyPcbComponent(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const currentDocument = await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB component editing');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	const primitive = await eda.pcb_PrimitiveComponent.modify(primitiveId, {
		layer: getOptionalString(params.layer) as TPCB_LayersOfComponent | undefined,
		x: getOptionalNumber(params.x),
		y: getOptionalNumber(params.y),
		rotation: getOptionalNumber(params.rotation),
		primitiveLock: getOptionalBoolean(params.primitiveLock),
		addIntoBom: getOptionalBoolean(params.addIntoBom),
		designator: getOptionalNullableString(params.designator),
		name: getOptionalNullableString(params.name),
		uniqueId: getOptionalNullableString(params.uniqueId),
		manufacturer: getOptionalNullableString(params.manufacturer),
		manufacturerId: getOptionalNullableString(params.manufacturerId),
		supplier: getOptionalNullableString(params.supplier),
		supplierId: getOptionalNullableString(params.supplierId),
		otherProperty: getOptionalUnknownRecord(params.otherProperty),
	});
	const saved = await savePcbDocumentIfRequested(currentDocument.uuid, getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		primitive,
		saved,
	};
}

async function deletePcbComponent(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const currentDocument = await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB component deletion');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	await maybeConfirmDestructiveAction(params, 'Delete PCB Component', `Delete PCB component primitive ${primitiveId}?`, 'Delete');
	const deleted = await eda.pcb_PrimitiveComponent.delete(primitiveId);
	const saved = await savePcbDocumentIfRequested(currentDocument.uuid, getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		deleted,
		saved,
	};
}

async function listPcbComponentPads(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for component pad queries');
	const componentPrimitiveId = getRequiredString(params.componentPrimitiveId, 'componentPrimitiveId');
	const pads = await listResolvedPcbPads(componentPrimitiveId);

	return {
		componentPrimitiveId,
		count: pads.length,
		pads: pads.map(pad => serializePcbPad(pad, componentPrimitiveId)),
	};
}

async function routePcbLineBetweenComponentPads(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const currentDocument = await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB pad-to-pad routing');
	const fromComponentPrimitiveId = getRequiredString(params.fromComponentPrimitiveId, 'fromComponentPrimitiveId');
	const fromPadNumber = getRequiredString(params.fromPadNumber, 'fromPadNumber');
	const toComponentPrimitiveId = getRequiredString(params.toComponentPrimitiveId, 'toComponentPrimitiveId');
	const toPadNumber = getRequiredString(params.toPadNumber, 'toPadNumber');
	const layer = getRequiredString(params.layer, 'layer') as TPCB_LayersOfLine;
	const fromPad = await requirePcbPad(fromComponentPrimitiveId, fromPadNumber);
	const toPad = await requirePcbPad(toComponentPrimitiveId, toPadNumber);
	const net = getRouteNet(fromPad, toPad, getOptionalString(params.net));
	const primitive = await createPcbLineSegment(
		net,
		layer,
		{ x: fromPad.getState_X(), y: fromPad.getState_Y() },
		{ x: toPad.getState_X(), y: toPad.getState_Y() },
		getOptionalNumber(params.lineWidth),
		getOptionalBoolean(params.primitiveLock),
	);
	const saved = await savePcbDocumentIfRequested(currentDocument.uuid, getOptionalBoolean(params.saveAfter));

	return {
		fromPad: serializePcbPad(fromPad),
		toPad: serializePcbPad(toPad),
		layer,
		net,
		primitive,
		saved,
	};
}

async function routePcbLinesBetweenComponentPads(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const currentDocument = await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for waypoint-based PCB routing');
	const fromComponentPrimitiveId = getRequiredString(params.fromComponentPrimitiveId, 'fromComponentPrimitiveId');
	const fromPadNumber = getRequiredString(params.fromPadNumber, 'fromPadNumber');
	const toComponentPrimitiveId = getRequiredString(params.toComponentPrimitiveId, 'toComponentPrimitiveId');
	const toPadNumber = getRequiredString(params.toPadNumber, 'toPadNumber');
	const layer = getRequiredString(params.layer, 'layer') as TPCB_LayersOfLine;
	const fromPad = await requirePcbPad(fromComponentPrimitiveId, fromPadNumber);
	const toPad = await requirePcbPad(toComponentPrimitiveId, toPadNumber);
	const net = getRouteNet(fromPad, toPad, getOptionalString(params.net));
	const waypoints = getRequiredWaypointArray(params.waypoints, 'waypoints');
	const points = [
		{ x: fromPad.getState_X(), y: fromPad.getState_Y() },
		...waypoints,
		{ x: toPad.getState_X(), y: toPad.getState_Y() },
	];
	const hostLayer = normalizePcbLineLayerForHost(layer) as TPCB_LayersOfLine;
	const polyline = await eda.pcb_PrimitivePolyline.create(
		net,
		hostLayer,
		eda.pcb_MathPolygon.createPolygon(buildPcbPolylineSource(points)),
		getOptionalNumber(params.lineWidth),
		getOptionalBoolean(params.primitiveLock),
	);

	const saved = await savePcbDocumentIfRequested(currentDocument.uuid, getOptionalBoolean(params.saveAfter));
	return {
		fromPad: serializePcbPad(fromPad),
		toPad: serializePcbPad(toPad),
		layer,
		net,
		waypoints,
		segmentCount: points.length - 1,
		primitives: polyline ? [polyline] : [],
		polyline,
		saved,
	};
}

async function addSchematicNetLabel(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic net label');
	const x = getRequiredNumber(params.x, 'x');
	const y = getRequiredNumber(params.y, 'y');
	const net = getRequiredString(params.net, 'net');
	assertSchematicNetLabelCapability();
	const primitive = await getSchematicAttributeApi().createNetLabel(x, y, net);
	const saved = getOptionalBoolean(params.saveAfter) ? await eda.sch_Document.save() : undefined;

	return {
		primitive,
		saved,
	};
}

async function addSchematicWire(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic wire');
	const line = getRequiredLineCoordinates(params.line, 'line');
	const primitive = await eda.sch_PrimitiveWire.create(
		line,
		getOptionalString(params.net),
		getOptionalNullableString(params.color),
		getOptionalNullableNumber(params.lineWidth),
		getOptionalNumber(params.lineType) as ESCH_PrimitiveLineType | null | undefined,
	);
	const saved = getOptionalBoolean(params.saveAfter) ? await eda.sch_Document.save() : undefined;

	return {
		primitive,
		saved,
	};
}

async function addPcbText(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB text');
	const currentDocument = await requireCurrentDocument();
	const layer = getRequiredString(params.layer, 'layer') as TPCB_LayersOfImage;
	const x = getRequiredNumber(params.x, 'x');
	const y = getRequiredNumber(params.y, 'y');
	const text = getRequiredString(params.text, 'text');
	const fontFamily = getRequiredString(params.fontFamily, 'fontFamily');
	const fontSize = getRequiredNumber(params.fontSize, 'fontSize');
	const lineWidth = getRequiredNumber(params.lineWidth, 'lineWidth');
	const primitive = await withHostMethodTimeout(
		'pcb_PrimitiveString.create',
		PCB_TEXT_HOST_TIMEOUT_MS,
		() => eda.pcb_PrimitiveString.create(
			layer,
			x,
			y,
			text,
			fontFamily,
			fontSize,
			lineWidth,
			(getOptionalNumber(params.alignMode) ?? 4) as EPCB_PrimitiveStringAlignMode,
			getOptionalNumber(params.rotation) ?? 0,
			getOptionalBoolean(params.reverse) ?? false,
			getOptionalNumber(params.expansion) ?? 0,
			getOptionalBoolean(params.mirror) ?? false,
			getOptionalBoolean(params.primitiveLock) ?? false,
		),
		PCB_TEXT_HOST_TIMEOUT_HINT,
	);
	const saved = getOptionalBoolean(params.saveAfter) ? await eda.pcb_Document.save(currentDocument.uuid) : undefined;

	return {
		primitive,
		saved,
	};
}

async function addPcbLine(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB line');
	const currentDocument = await requireCurrentDocument();
	const layer = getRequiredString(params.layer, 'layer') as TPCB_LayersOfLine;
	const net = resolvePcbLineNetForCreate(layer, params.net);
	const hostLayer = normalizePcbLineLayerForHost(layer) as TPCB_LayersOfLine;
	const startX = getRequiredNumber(params.startX, 'startX');
	const startY = getRequiredNumber(params.startY, 'startY');
	const endX = getRequiredNumber(params.endX, 'endX');
	const endY = getRequiredNumber(params.endY, 'endY');
	const primitive = await eda.pcb_PrimitiveLine.create(
		net,
		hostLayer,
		startX,
		startY,
		endX,
		endY,
		getOptionalNumber(params.lineWidth),
		getOptionalBoolean(params.primitiveLock),
	);
	const saved = getOptionalBoolean(params.saveAfter) ? await eda.pcb_Document.save(currentDocument.uuid) : undefined;

	return {
		primitive,
		saved,
	};
}

async function listPcbPrimitiveIds(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB primitive queries');
	const family = getRequiredString(params.family, 'family');
	let primitiveIds: string[];

	switch (family) {
		case 'line':
			primitiveIds = await eda.pcb_PrimitiveLine.getAllPrimitiveId(
				getOptionalString(params.net),
				getOptionalString(params.layer) as TPCB_LayersOfLine | undefined,
				getOptionalBoolean(params.primitiveLock),
			);
			break;
		case 'text':
			primitiveIds = await withHostMethodTimeout(
				'pcb_PrimitiveString.getAllPrimitiveId',
				PCB_TEXT_HOST_TIMEOUT_MS,
				() => eda.pcb_PrimitiveString.getAllPrimitiveId(
					getOptionalString(params.layer) as TPCB_LayersOfImage | undefined,
					getOptionalBoolean(params.primitiveLock),
				),
				PCB_TEXT_HOST_TIMEOUT_HINT,
			);
			break;
		case 'component':
			primitiveIds = await eda.pcb_PrimitiveComponent.getAllPrimitiveId(
				getOptionalString(params.layer) as TPCB_LayersOfComponent | undefined,
				getOptionalBoolean(params.primitiveLock),
			);
			break;
		default:
			throw new Error(`Unsupported PCB primitive family: ${family}`);
	}

	return {
		family,
		count: primitiveIds.length,
		primitiveIds,
	};
}

async function getPcbPrimitive(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB primitive queries');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	const primitive = await eda.pcb_Primitive.getPrimitiveByPrimitiveId(primitiveId);

	return {
		primitiveId,
		primitive,
	};
}

async function getPcbPrimitivesBBox(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB bounding-box queries');
	const primitiveIds = getRequiredStringArray(params.primitiveIds, 'primitiveIds');
	const bbox = await eda.pcb_Primitive.getPrimitivesBBox(primitiveIds);

	return {
		primitiveIds,
		bbox,
	};
}

async function listPcbNets(): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB net queries');
	const nets = await eda.pcb_Net.getAllNets();

	return {
		count: nets.length,
		nets,
		names: nets.map(net => net.net),
	};
}

async function getPcbNet(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB net queries');
	const net = getRequiredString(params.net, 'net');
	const [details, length, color] = await Promise.all([
		eda.pcb_Net.getNet(net),
		eda.pcb_Net.getNetLength(net),
		eda.pcb_Net.getNetColor(net),
	]);

	return {
		net,
		details,
		length,
		color,
	};
}

async function setPcbNetColor(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB net editing');
	const net = getRequiredString(params.net, 'net');
	const color = getRequiredPcbNetColor(params.color, 'color');
	const updated = await eda.pcb_Net.setNetColor(net, color);
	const currentColor = await eda.pcb_Net.getNetColor(net);

	return {
		net,
		color: currentColor,
		updated,
	};
}

async function getPcbNetPrimitives(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB net queries');
	const net = getRequiredString(params.net, 'net');
	const primitiveTypes = getOptionalNumberArray(params.primitiveTypes) as Array<EPCB_PrimitiveType> | undefined;
	const primitives = await eda.pcb_Net.getAllPrimitivesByNet(net, primitiveTypes);

	return {
		net,
		count: primitives.length,
		primitives,
	};
}

async function modifySchematicText(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic text');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	const primitive = await eda.sch_PrimitiveText.modify(primitiveId, {
		x: getOptionalNumber(params.x),
		y: getOptionalNumber(params.y),
		content: getOptionalString(params.content),
		rotation: getOptionalNumber(params.rotation),
		textColor: getOptionalNullableString(params.textColor),
		fontName: getOptionalNullableString(params.fontName),
		fontSize: getOptionalNullableNumber(params.fontSize),
		bold: getOptionalBoolean(params.bold),
		italic: getOptionalBoolean(params.italic),
		underLine: getOptionalBoolean(params.underLine),
		alignMode: getOptionalNumber(params.alignMode) as ESCH_PrimitiveTextAlignMode | undefined,
	});
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		primitive,
		saved,
	};
}

async function deleteSchematicText(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic text deletion');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	await maybeConfirmDestructiveAction(params, 'Delete Schematic Text', `Delete schematic text primitive ${primitiveId}?`, 'Delete');
	const deleted = await eda.sch_PrimitiveText.delete(primitiveId);
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		deleted,
		saved,
	};
}

async function modifySchematicNetLabel(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic net label');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	const primitive = await getSchematicAttributeApi().modify(primitiveId, {
		x: getOptionalNullableNumber(params.x),
		y: getOptionalNullableNumber(params.y),
		rotation: getOptionalNullableNumber(params.rotation),
		color: getOptionalNullableString(params.color),
		fontName: getOptionalNullableString(params.fontName),
		fontSize: getOptionalNullableNumber(params.fontSize),
		bold: getOptionalNullableBoolean(params.bold),
		italic: getOptionalNullableBoolean(params.italic),
		underLine: getOptionalNullableBoolean(params.underLine),
		alignMode: getOptionalNullableNumber(params.alignMode) as ESCH_PrimitiveTextAlignMode | null | undefined,
		fillColor: getOptionalNullableString(params.fillColor),
		value: getOptionalString(params.net),
		keyVisible: getOptionalNullableBoolean(params.keyVisible),
		valueVisible: getOptionalNullableBoolean(params.valueVisible),
	});
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		primitive,
		saved,
	};
}

async function modifySchematicWire(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic wire');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	const primitive = await eda.sch_PrimitiveWire.modify(primitiveId, {
		line: getOptionalLineCoordinates(params.line),
		net: getOptionalString(params.net),
		color: getOptionalNullableString(params.color),
		lineWidth: getOptionalNullableNumber(params.lineWidth),
		lineType: getOptionalNullableNumber(params.lineType) as ESCH_PrimitiveLineType | null | undefined,
	});
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		primitive,
		saved,
	};
}

async function deleteSchematicWire(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic wire deletion');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	await maybeConfirmDestructiveAction(params, 'Delete Schematic Wire', `Delete schematic wire primitive ${primitiveId}?`, 'Delete');
	const deleted = await eda.sch_PrimitiveWire.delete(primitiveId);
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		deleted,
		saved,
	};
}

async function modifyPcbLine(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const currentDocument = await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB line');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	const layer = getOptionalString(params.layer);
	const primitive = await eda.pcb_PrimitiveLine.modify(primitiveId, {
		net: getOptionalTrimmedStringIncludingEmpty(params.net),
		layer: layer === undefined ? undefined : normalizePcbLineLayerForHost(layer) as TPCB_LayersOfLine,
		startX: getOptionalNumber(params.startX),
		startY: getOptionalNumber(params.startY),
		endX: getOptionalNumber(params.endX),
		endY: getOptionalNumber(params.endY),
		lineWidth: getOptionalNumber(params.lineWidth),
		primitiveLock: getOptionalBoolean(params.primitiveLock),
	});
	const saved = await savePcbDocumentIfRequested(currentDocument.uuid, getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		primitive,
		saved,
	};
}

async function deletePcbLine(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const currentDocument = await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB line deletion');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	await maybeConfirmDestructiveAction(params, 'Delete PCB Line', `Delete PCB line primitive ${primitiveId}?`, 'Delete');
	const deleted = await eda.pcb_PrimitiveLine.delete(primitiveId);
	const saved = await savePcbDocumentIfRequested(currentDocument.uuid, getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		deleted,
		saved,
	};
}

async function modifyPcbText(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const currentDocument = await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB text');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	const primitive = await withHostMethodTimeout(
		'pcb_PrimitiveString.modify',
		PCB_TEXT_HOST_TIMEOUT_MS,
		() => eda.pcb_PrimitiveString.modify(primitiveId, {
			layer: getOptionalString(params.layer) as TPCB_LayersOfImage | undefined,
			x: getOptionalNumber(params.x),
			y: getOptionalNumber(params.y),
			text: getOptionalString(params.text),
			fontFamily: getOptionalString(params.fontFamily),
			fontSize: getOptionalNumber(params.fontSize),
			lineWidth: getOptionalNumber(params.lineWidth),
			alignMode: getOptionalNumber(params.alignMode) as EPCB_PrimitiveStringAlignMode | undefined,
			rotation: getOptionalNumber(params.rotation),
			reverse: getOptionalBoolean(params.reverse),
			expansion: getOptionalNumber(params.expansion),
			mirror: getOptionalBoolean(params.mirror),
			primitiveLock: getOptionalBoolean(params.primitiveLock),
		}),
		PCB_TEXT_HOST_TIMEOUT_HINT,
	);
	const saved = await savePcbDocumentIfRequested(currentDocument.uuid, getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		primitive,
		saved,
	};
}

async function deletePcbText(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const currentDocument = await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, 'PCB document required for PCB text deletion');
	const primitiveId = getRequiredString(params.primitiveId, 'primitiveId');
	await maybeConfirmDestructiveAction(params, 'Delete PCB Text', `Delete PCB text primitive ${primitiveId}?`, 'Delete');
	const deleted = await withHostMethodTimeout(
		'pcb_PrimitiveString.delete',
		PCB_TEXT_HOST_TIMEOUT_MS,
		() => eda.pcb_PrimitiveString.delete(primitiveId),
		PCB_TEXT_HOST_TIMEOUT_HINT,
	);
	const saved = await savePcbDocumentIfRequested(currentDocument.uuid, getOptionalBoolean(params.saveAfter));

	return {
		primitiveId,
		deleted,
		saved,
	};
}

async function renameBoard(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const originalBoardName = getRequiredString(params.originalBoardName, 'originalBoardName');
	const boardName = getRequiredString(params.boardName, 'boardName');
	const renamed = await eda.dmt_Board.modifyBoardName(originalBoardName, boardName);

	return {
		originalBoardName,
		boardName,
		renamed,
	};
}

async function renamePcb(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const pcbUuid = getRequiredString(params.pcbUuid, 'pcbUuid');
	const pcbName = getRequiredString(params.pcbName, 'pcbName');
	const renamed = await eda.dmt_Pcb.modifyPcbName(pcbUuid, pcbName);

	return {
		pcbUuid,
		pcbName,
		renamed,
	};
}

async function renameSchematic(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const schematicUuid = getRequiredString(params.schematicUuid, 'schematicUuid');
	const schematicName = getRequiredString(params.schematicName, 'schematicName');
	const renamed = await eda.dmt_Schematic.modifySchematicName(schematicUuid, schematicName);

	return {
		schematicUuid,
		schematicName,
		renamed,
	};
}

async function renameSchematicPage(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const schematicPageUuid = getRequiredString(params.schematicPageUuid, 'schematicPageUuid');
	const schematicPageName = getRequiredString(params.schematicPageName, 'schematicPageName');
	const renamed = await eda.dmt_Schematic.modifySchematicPageName(schematicPageUuid, schematicPageName);

	return {
		schematicPageUuid,
		schematicPageName,
		renamed,
	};
}

async function renamePanel(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const panelUuid = getRequiredString(params.panelUuid, 'panelUuid');
	const panelName = getRequiredString(params.panelName, 'panelName');
	const renamed = await eda.dmt_Panel.modifyPanelName(panelUuid, panelName);

	return {
		panelUuid,
		panelName,
		renamed,
	};
}

async function deleteBoard(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const boardName = getRequiredString(params.boardName, 'boardName');
	await maybeConfirmDestructiveAction(
		params,
		'Delete Board',
		`Delete board ${boardName}? This cannot be undone from the MCP bridge.`,
		'Delete',
	);
	const deleted = await eda.dmt_Board.deleteBoard(boardName);

	return {
		boardName,
		deleted,
	};
}

async function deletePcb(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const pcbUuid = getRequiredString(params.pcbUuid, 'pcbUuid');
	await maybeConfirmDestructiveAction(
		params,
		'Delete PCB',
		`Delete PCB ${pcbUuid}? This may also remove linked items depending on EasyEDA project associations.`,
		'Delete',
	);
	const deleted = await eda.dmt_Pcb.deletePcb(pcbUuid);

	return {
		pcbUuid,
		deleted,
	};
}

async function deleteSchematic(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const schematicUuid = getRequiredString(params.schematicUuid, 'schematicUuid');
	await maybeConfirmDestructiveAction(
		params,
		'Delete Schematic',
		`Delete schematic ${schematicUuid}? Linked PCB or CBB content may also be affected by EasyEDA.`,
		'Delete',
	);
	const deleted = await eda.dmt_Schematic.deleteSchematic(schematicUuid);

	return {
		schematicUuid,
		deleted,
	};
}

async function deleteSchematicPage(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const schematicPageUuid = getRequiredString(params.schematicPageUuid, 'schematicPageUuid');
	await maybeConfirmDestructiveAction(
		params,
		'Delete Schematic Page',
		`Delete schematic page ${schematicPageUuid}? This cannot be undone from the MCP bridge.`,
		'Delete',
	);
	const deleted = await eda.dmt_Schematic.deleteSchematicPage(schematicPageUuid);

	return {
		schematicPageUuid,
		deleted,
	};
}

async function deletePanel(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const panelUuid = getRequiredString(params.panelUuid, 'panelUuid');
	await maybeConfirmDestructiveAction(
		params,
		'Delete Panel',
		`Delete panel ${panelUuid}? This cannot be undone from the MCP bridge.`,
		'Delete',
	);
	const deleted = await eda.dmt_Panel.deletePanel(panelUuid);

	return {
		panelUuid,
		deleted,
	};
}

async function getDocumentSource(): Promise<Record<string, unknown>> {
	const source = (await eda.sys_FileManager.getDocumentSource()) ?? '';
	return {
		source,
		sourceHash: computeSourceRevision(source),
		characters: source.length,
	};
}

async function setDocumentSource(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const source = getRequiredString(params.source, 'source');
	const expectedSourceHash = getOptionalString(params.expectedSourceHash);
	const force = getOptionalBoolean(params.force);
	const skipConfirmation = getOptionalBoolean(params.skipConfirmation) === true;
	const currentSource = (await eda.sys_FileManager.getDocumentSource()) ?? '';
	const currentSourceHash = computeSourceRevision(currentSource);

	if (!force && !expectedSourceHash)
		throw new Error('expectedSourceHash is required unless force is true');

	if (!force && expectedSourceHash !== currentSourceHash) {
		throw new Error(`Active document source changed. Expected ${expectedSourceHash} but found ${currentSourceHash}`);
	}

	if (!skipConfirmation) {
		const confirmMessage = `Replace the active document source with ${source.length} characters of MCP-provided content?`;
		await confirmDestructiveAction('Overwrite Document Source', confirmMessage, 'Overwrite');
	}
	const updated = await eda.sys_FileManager.setDocumentSource(source);

	return {
		updated,
		characters: source.length,
		sourceHash: computeSourceRevision(source),
		previousSourceHash: currentSourceHash,
	};
}

function getSupportedMethods(): BridgeMethod[] {
	return [
		'get_capabilities',
		'ping_bridge',
		'echo_bridge',
		'search_library_devices',
		'get_current_context',
		'list_project_objects',
		'open_document',
		'save_active_document',
		'create_board',
		'create_pcb',
		'import_schematic_to_pcb',
		'create_panel',
		'create_schematic',
		'create_schematic_page',
		'copy_board',
		'copy_pcb',
		'copy_panel',
		'copy_schematic',
		'copy_schematic_page',
		'add_schematic_component',
		'modify_schematic_component',
		'delete_schematic_component',
		'add_schematic_net_flag',
		'add_schematic_net_port',
		'add_schematic_short_circuit_flag',
		'list_schematic_component_pins',
		'set_schematic_pin_no_connect',
		'connect_schematic_pin_to_net',
		'connect_schematic_pins_to_nets',
		'connect_schematic_pins_with_prefix',
		'add_schematic_text',
		'add_schematic_net_label',
		'add_schematic_wire',
		'list_schematic_primitive_ids',
		'get_schematic_primitive',
		'get_schematic_primitives_bbox',
		'add_pcb_component',
		'modify_pcb_component',
		'delete_pcb_component',
		'list_pcb_component_pads',
		'route_pcb_line_between_component_pads',
		'route_pcb_lines_between_component_pads',
		'add_pcb_line',
		'add_pcb_text',
		'list_pcb_primitive_ids',
		'get_pcb_primitive',
		'get_pcb_primitives_bbox',
		'list_pcb_nets',
		'get_pcb_net',
		'set_pcb_net_color',
		'get_pcb_net_primitives',
		'modify_schematic_text',
		'delete_schematic_text',
		'modify_schematic_net_label',
		'modify_schematic_wire',
		'delete_schematic_wire',
		'modify_pcb_line',
		'delete_pcb_line',
		'modify_pcb_text',
		'delete_pcb_text',
		'rename_board',
		'rename_pcb',
		'rename_schematic',
		'rename_schematic_page',
		'rename_panel',
		'delete_board',
		'delete_pcb',
		'delete_schematic',
		'delete_schematic_page',
		'delete_panel',
		'get_document_source',
		'set_document_source',
	];
}

async function requireCurrentDocument(): Promise<IDMT_EditorDocumentItem> {
	const currentContext = await getCurrentContext();
	const currentDocument = currentContext.currentDocument as IDMT_EditorDocumentItem | undefined;
	if (!currentDocument)
		throw new Error('No active EasyEDA document is focused');

	return currentDocument;
}

async function openPcbDocumentIfNeeded(pcbUuid: string): Promise<void> {
	const currentDocument = await requireCurrentDocument();
	if (currentDocument?.uuid === pcbUuid && currentDocument.documentType === EDMT_EditorDocumentType.PCB)
		return;

	await eda.dmt_EditorControl.openDocument(pcbUuid);
	await requireCurrentDocumentType(EDMT_EditorDocumentType.PCB, `PCB ${pcbUuid} must be open before schematic import readback`);
}

async function getSchematicPageTitleBlockAttribute(schematicPageUuid: string, attributeName: string): Promise<string | undefined> {
	const currentDocument = await requireCurrentDocument();
	if (currentDocument.uuid !== schematicPageUuid || currentDocument.documentType !== EDMT_EditorDocumentType.SCHEMATIC_PAGE) {
		await eda.dmt_EditorControl.openDocument(schematicPageUuid);
	}

	await requireCurrentDocumentType(
		EDMT_EditorDocumentType.SCHEMATIC_PAGE,
		`Schematic page ${schematicPageUuid} must be open before title-block source readback`,
	);
	const source = (await eda.sys_FileManager.getDocumentSource()) ?? '';
	return getSchematicTitleBlockAttributeFromSource(source, attributeName);
}

async function importEmptyPcbFromHostUi(pcbUuid: string): Promise<boolean> {
	await openPcbDocumentIfNeeded(pcbUuid);
	const shellWindow = getAccessibleEditorShellWindow();
	const shellDocument = shellWindow?.document;
	if (!shellWindow || !shellDocument)
		throw new Error('This EasyEDA host does not expose the editor shell document, so the empty-PCB host-UI import fallback is unavailable.');

	await openTopBarMenu(shellDocument, 'Design', 'mm-common-design');
	const importMenuItem = await waitForShellElement(
		() => findMenuItemByText(shellDocument, 'mm-common-design', 'Import Changes from Schematic'),
		1_500,
	);
	if (!importMenuItem)
		throw new Error('EasyEDA did not expose Design -> Import Changes from Schematic, so the empty-PCB host-UI import fallback is unavailable.');

	const itemHandled = await triggerReactClick(importMenuItem);
	if (!itemHandled)
		(importMenuItem as HTMLElement).click();

	const applyButton = await waitForShellElement(
		() => findClickableElementByText(shellDocument, 'Apply Changes', ['button']),
		5_000,
	);
	if (!applyButton)
		return false;

	(applyButton as HTMLElement).click();
	return waitForShellCondition(
		() => !findClickableElementByText(shellDocument, 'Apply Changes', ['button']),
		15_000,
	);
}

export function buildEmptyPcbImportCompareMapFromSchematicNetlist(rawNetlist: string): Record<string, Record<string, unknown>> {
	const parsed = parseSchematicNetlistJson(rawNetlist);
	const compareMap: Record<string, Record<string, unknown>> = {};

	for (const [uniqueId, rawComponent] of Object.entries(parsed)) {
		const props = getRecord(rawComponent.props);
		if (!props)
			continue;

		const footprintUuid = typeof props.Footprint === 'string' ? props.Footprint : undefined;
		const deviceUuid = typeof props.Device === 'string' ? props.Device : undefined;
		if (!footprintUuid || !deviceUuid)
			continue;

		const componentUniqueId = typeof props['Unique ID'] === 'string' && props['Unique ID']
			? props['Unique ID']
			: uniqueId;
		const nets = normalizeSchematicNetlistPins(rawComponent.pins);
		compareMap[componentUniqueId] = {
			addComponent: {
				uniqueId: componentUniqueId,
				props,
				nets,
				extra: {
					bindingLibs: {
						device: {
							uuid: deviceUuid,
							isProLib: true,
						},
						footprint: {
							uuid: footprintUuid,
							isProLib: true,
						},
					},
				},
			},
		};
	}

	return compareMap;
}

function parseSchematicNetlistJson(rawNetlist: string): Record<string, { props?: unknown; pins?: unknown }> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawNetlist);
	}
	catch (error: unknown) {
		throw new Error(`Could not parse EasyEDA schematic netlist JSON: ${toErrorMessage(error)}`);
	}

	if (!isRecord(parsed))
		throw new Error('EasyEDA schematic netlist fallback returned a non-object JSON payload.');

	return parsed as Record<string, { props?: unknown; pins?: unknown }>;
}

function normalizeSchematicNetlistPins(rawPins: unknown): Record<string, string> {
	if (!isRecord(rawPins))
		return {};

	const nets: Record<string, string> = {};
	for (const [pinNumber, value] of Object.entries(rawPins)) {
		nets[pinNumber] = typeof value === 'string' ? value : '';
	}

	return nets;
}

function getRecord(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value))
		return undefined;

	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === 'string')
			result[key] = entry;
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getAccessibleEditorShellWindow(): (Window & typeof globalThis) | undefined {
	try {
		if (typeof window !== 'undefined' && window.top)
			return window.top;
	}
	catch {
		// Ignore cross-window access issues and fall back to the local runtime window.
	}

	return typeof window !== 'undefined' ? window : undefined;
}

async function openTopBarMenu(doc: Document, menuTitle: string, expectedMenuId: string): Promise<void> {
	const titleNode = findElementByTitle(doc, menuTitle);
	if (!titleNode)
		throw new Error(`EasyEDA did not expose the ${menuTitle} top-bar menu while preparing the empty-PCB host-UI import fallback.`);

	const reactProps = getReactProps<Record<string, unknown>>(titleNode);
	const onClick = typeof reactProps?.onClick === 'function' ? reactProps.onClick as (event: unknown) => Promise<unknown> | unknown : undefined;
	if (!onClick)
		throw new Error(`EasyEDA did not expose a clickable ${menuTitle} top-bar menu while preparing the empty-PCB host-UI import fallback.`);

	await onClick(createSyntheticReactMouseEvent(titleNode));
	const menuOpened = await waitForShellCondition(() => Boolean(doc.getElementById(expectedMenuId)), 1_500);
	if (!menuOpened)
		throw new Error(`EasyEDA did not open the ${menuTitle} menu while preparing the empty-PCB host-UI import fallback.`);
}

async function triggerReactClick(element: Element): Promise<boolean> {
	const reactProps = getReactProps<Record<string, unknown>>(element);
	const onClick = typeof reactProps?.onClick === 'function' ? reactProps.onClick as (event: unknown) => Promise<unknown> | unknown : undefined;
	if (!onClick)
		return false;

	await onClick(createSyntheticReactMouseEvent(element));
	return true;
}

function createSyntheticReactMouseEvent(element: Element): {
	ctrlKey: false;
	currentTarget: Element;
	target: Element;
	preventDefault: () => void;
	stopPropagation: () => void;
} {
	return {
		ctrlKey: false,
		currentTarget: element,
		target: element,
		preventDefault() {},
		stopPropagation() {},
	};
}

async function waitForShellElement<T>(resolveElement: () => T | null | undefined, timeoutMs: number): Promise<T | undefined> {
	let resolved = resolveElement();
	if (resolved)
		return resolved;

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await delay(50);
		resolved = resolveElement();
		if (resolved)
			return resolved;
	}

	return undefined;
}

async function waitForShellCondition(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
	if (predicate())
		return true;

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await delay(50);
		if (predicate())
			return true;
	}

	return false;
}

function delay(timeoutMs: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, timeoutMs));
}

function findElementByTitle(doc: Document, title: string): Element | undefined {
	return Array.from(doc.querySelectorAll('[title]')).find(element => element.getAttribute('title') === title);
}

function findMenuItemByText(doc: Document, menuId: string, text: string): Element | undefined {
	const menu = doc.getElementById(menuId);
	if (!menu)
		return undefined;

	return Array.from(menu.querySelectorAll('.eda-menu-item_g86Ag')).find(element => (element.textContent || '').includes(text));
}

function findClickableElementByText(doc: Document, text: string, tagNames?: string[]): Element | undefined {
	const normalizedTagNames = tagNames?.map(name => name.toUpperCase());
	return Array.from(doc.querySelectorAll('*')).find((element) => {
		if (normalizedTagNames && !normalizedTagNames.includes(element.tagName.toUpperCase()))
			return false;

		return (element.textContent || '').trim() === text;
	});
}

function getReactProps<T>(element: Element): T | undefined {
	const key = Object.keys(element).find(candidate => candidate.startsWith('__reactProps$'));
	if (!key)
		return undefined;

	return (element as Element & Record<string, unknown>)[key] as T | undefined;
}

function getEditorShellIframes(doc: Document | undefined): Array<{ id?: string; src?: string; className?: string }> {
	if (!doc?.querySelectorAll)
		return [];

	return Array.from(doc.querySelectorAll('iframe')).map(frame => ({
		id: frame.id || undefined,
		src: frame.getAttribute('src') || undefined,
		className: frame.className || undefined,
	}));
}

function inferCurrentProjectFromShell(urlHash: string): Record<string, unknown> | undefined {
	const projectMatch = urlHash.match(/(?:^|[#,])id=([^,]+)/);
	const projectUuid = projectMatch?.[1] ? decodeURIComponent(projectMatch[1]) : undefined;
	if (!projectUuid)
		return undefined;

	return {
		uuid: projectUuid,
		inferredFromEditorShell: true,
	};
}

interface ProjectInventory {
	boards: unknown[];
	pcbs: unknown[];
}

async function getVerifiedProjectInventory(): Promise<ProjectInventory> {
	const [boards, pcbs] = await Promise.all([
		eda.dmt_Board.getAllBoardsInfo(),
		eda.dmt_Pcb.getAllPcbsInfo(),
	]);

	return {
		boards: Array.isArray(boards) ? boards : [],
		pcbs: Array.isArray(pcbs) ? pcbs : [],
	};
}

async function requireCurrentDocumentType(
	expectedDocumentType: EDMT_EditorDocumentType,
	errorMessage: string,
): Promise<IDMT_EditorDocumentItem> {
	const currentDocument = await requireCurrentDocument();
	if (currentDocument.documentType !== expectedDocumentType)
		throw new Error(errorMessage);

	return currentDocument;
}

async function saveSchematicDocumentIfRequested(saveAfter?: boolean): Promise<boolean | undefined> {
	return saveAfter ? eda.sch_Document.save() : undefined;
}

async function savePcbDocumentIfRequested(documentUuid: string, saveAfter?: boolean): Promise<boolean | undefined> {
	return saveAfter ? eda.pcb_Document.save(documentUuid) : undefined;
}

async function confirmDestructiveAction(
	title: string,
	content: string,
	mainButtonTitle: string,
): Promise<void> {
	const confirmed = await new Promise<boolean>((resolve) => {
		eda.sys_Dialog.showConfirmationMessage(
			content,
			title,
			mainButtonTitle,
			'Cancel',
			(mainButtonClicked) => {
				resolve(Boolean(mainButtonClicked));
			},
		);
	});

	if (!confirmed)
		throw new Error(`${title} cancelled by user`);
}

async function maybeConfirmDestructiveAction(
	params: Record<string, unknown>,
	title: string,
	content: string,
	mainButtonTitle: string,
): Promise<void> {
	if (getOptionalBoolean(params.skipConfirmation) === true)
		return;

	await confirmDestructiveAction(title, content, mainButtonTitle);
}

function getBridgeEndpoint(): string {
	const storedValue = eda.sys_Storage.getExtensionUserConfig(MCP_BRIDGE_CONFIG_KEY);
	return typeof storedValue === 'string' && storedValue.trim() ? storedValue.trim() : DEFAULT_BRIDGE_ENDPOINT;
}

function hydratePersistedBridgeState(): void {
	const storedValue = eda.sys_Storage.getExtensionUserConfig(MCP_BRIDGE_RUNTIME_STATE_KEY);
	if (!storedValue || typeof storedValue !== 'object')
		return;

	const persistedState = storedValue as Partial<BridgeState>;
	if (typeof persistedState.endpoint === 'string' && persistedState.endpoint.trim())
		bridgeState.endpoint = persistedState.endpoint;
	if (typeof persistedState.connectAttempts === 'number' && Number.isFinite(persistedState.connectAttempts))
		bridgeState.connectAttempts = persistedState.connectAttempts;
	bridgeState.socketId = typeof persistedState.socketId === 'string' && persistedState.socketId.trim()
		? persistedState.socketId
		: bridgeState.socketId;
	bridgeState.lastAttemptAt = typeof persistedState.lastAttemptAt === 'number' ? persistedState.lastAttemptAt : bridgeState.lastAttemptAt;
	bridgeState.lastConnectedAt = typeof persistedState.lastConnectedAt === 'number' ? persistedState.lastConnectedAt : bridgeState.lastConnectedAt;
	bridgeState.lastError = typeof persistedState.lastError === 'string' ? persistedState.lastError : undefined;
	bridgeState.lastEvent = typeof persistedState.lastEvent === 'string' ? persistedState.lastEvent : undefined;
	bridgeState.serverInfo = isRecord(persistedState.serverInfo) ? persistedState.serverInfo : bridgeState.serverInfo;
}

async function persistBridgeState(): Promise<void> {
	try {
		await eda.sys_Storage.setExtensionUserConfig(MCP_BRIDGE_RUNTIME_STATE_KEY, { ...bridgeState });
	}
	catch {
		// Best-effort persistence for command-to-command status visibility.
	}
}

function sendSocketMessage(
	message: ReturnType<typeof createBridgeResponse> | ReturnType<typeof createBridgeError> | ReturnType<typeof createExtensionHello>,
	socketId = bridgeState.socketId ?? MCP_BRIDGE_SOCKET_ID,
): void {
	if (!shouldHandleBridgeSocketCallback(bridgeState.socketId, socketId))
		return;

	try {
		eda.sys_WebSocket.send(socketId, serializeBridgeEnvelope(message));
		bridgeState.lastEvent = 'sent websocket message';
		void persistBridgeState();
	}
	catch (error: unknown) {
		bridgeState.connected = false;
		bridgeState.lastError = toErrorMessage(error);
		bridgeState.lastEvent = 'websocket send threw';
		void persistBridgeState();
		logInfo(`MCP bridge send failed: ${bridgeState.lastError}`);
	}
}

function scheduleConnectionDiagnostic(socketId: string): void {
	clearPendingConnectionDiagnosticTimer();
	pendingConnectionDiagnosticTimer = setTimeout(() => {
		if (!shouldHandleBridgeSocketCallback(bridgeState.socketId, socketId))
			return;

		if (bridgeState.connected)
			return;

		bridgeState.lastEvent = 'websocket connection timed out';
		bridgeState.lastError = 'No websocket connected callback was received from EasyEDA. Verify the MCP server is running, the endpoint is reachable, and external interaction permission is enabled.';
		void persistBridgeState();
	}, 3000);
}

function clearPendingConnectionDiagnosticTimer(): void {
	if (!pendingConnectionDiagnosticTimer)
		return;

	clearTimeout(pendingConnectionDiagnosticTimer);
	pendingConnectionDiagnosticTimer = undefined;
}

function getRequiredString(value: unknown, key: string): string {
	if (typeof value !== 'string' || !value.trim())
		throw new Error(`Expected a non-empty string for ${key}`);

	return value.trim();
}

function getRequiredNumber(value: unknown, key: string): number {
	if (typeof value !== 'number' || Number.isNaN(value))
		throw new Error(`Expected a valid number for ${key}`);

	return value;
}

function getRequiredLineCoordinates(value: unknown, key: string): Array<number> | Array<Array<number>> {
	if (!Array.isArray(value) || value.length === 0)
		throw new Error(`Expected a non-empty coordinate array for ${key}`);

	return value as Array<number> | Array<Array<number>>;
}

function getRequiredStringArray(value: unknown, key: string): string[] {
	const items = getOptionalStringArray(value);
	if (!items?.length)
		throw new Error(`Expected a non-empty string array for ${key}`);

	return items;
}

function getOptionalLineCoordinates(value: unknown): Array<number> | Array<Array<number>> | undefined {
	if (!Array.isArray(value) || value.length === 0)
		return undefined;

	return value as Array<number> | Array<Array<number>>;
}

function getOptionalString(value: unknown): string | undefined {
	if (typeof value !== 'string')
		return undefined;

	const trimmedValue = value.trim();
	return trimmedValue || undefined;
}

function getOptionalStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value))
		return undefined;

	const items = value
		.map(item => typeof item === 'string' ? item.trim() : '')
		.filter(Boolean);

	return items.length ? items : undefined;
}

function getOptionalStringOrStringArray(value: unknown): string | string[] | undefined {
	if (typeof value === 'string')
		return getOptionalString(value);

	return getOptionalStringArray(value);
}

function getOptionalNumber(value: unknown): number | undefined {
	if (typeof value !== 'number' || Number.isNaN(value))
		return undefined;

	return value;
}

function getOptionalBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function getOptionalNullableString(value: unknown): string | null | undefined {
	if (value === null)
		return null;

	return getOptionalString(value);
}

function getOptionalNullableNumber(value: unknown): number | null | undefined {
	if (value === null)
		return null;

	return getOptionalNumber(value);
}

function getOptionalNullableBoolean(value: unknown): boolean | null | undefined {
	if (value === null)
		return null;

	return getOptionalBoolean(value);
}

function getRequiredDeviceReference(value: Record<string, unknown>): { libraryUuid: string; uuid: string } {
	return {
		libraryUuid: getRequiredString(value.libraryUuid, 'libraryUuid'),
		uuid: getRequiredString(value.deviceUuid, 'deviceUuid'),
	};
}

function getOptionalScalarRecord(value: unknown): Record<string, string | number | boolean> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return undefined;

	const entries = Object.entries(value).filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item));
	return entries.length ? Object.fromEntries(entries) as Record<string, string | number | boolean> : undefined;
}

function getOptionalUnknownRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return undefined;

	return value as Record<string, unknown>;
}

function getOptionalNumberArray(value: unknown): number[] | undefined {
	if (!Array.isArray(value))
		return undefined;

	const items = value.filter((item): item is number => typeof item === 'number' && !Number.isNaN(item));
	return items.length ? items : undefined;
}

function getRequiredPcbNetColor(value: unknown, key: string): { r: number; g: number; b: number; alpha: number } | null {
	if (value === null)
		return null;

	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error(`Expected a color object or null for ${key}`);

	const candidate = value as Record<string, unknown>;
	return {
		r: getRequiredNumber(candidate.r, `${key}.r`),
		g: getRequiredNumber(candidate.g, `${key}.g`),
		b: getRequiredNumber(candidate.b, `${key}.b`),
		alpha: getRequiredNumber(candidate.alpha, `${key}.alpha`),
	};
}

async function requireSchematicPin(componentPrimitiveId: string, pinNumber: string): Promise<ISCH_PrimitiveComponentPin> {
	const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(componentPrimitiveId) ?? [];
	const pin = pins.find(candidate => candidate.getState_PinNumber() === pinNumber);
	if (!pin)
		throw new Error(`Unable to find schematic pin ${pinNumber} on component ${componentPrimitiveId}`);

	return pin;
}

async function requirePcbPad(componentPrimitiveId: string, padNumber: string): Promise<IPCB_PrimitiveComponentPad> {
	const pads = await listResolvedPcbPads(componentPrimitiveId);
	const pad = pads.find(candidate => candidate.getState_PadNumber() === padNumber);
	if (!pad)
		throw new Error(`Unable to find PCB pad ${padNumber} on component ${componentPrimitiveId}`);

	return pad;
}

async function listResolvedPcbPads(componentPrimitiveId: string): Promise<IPCB_PrimitiveComponentPad[]> {
	const component = await eda.pcb_PrimitiveComponent.get(componentPrimitiveId) as { pads?: unknown } | undefined;
	const allPads = await eda.pcb_PrimitivePad.getAll() as IPCB_PrimitiveComponentPad[] | undefined;
	if (Array.isArray(allPads) && allPads.length > 0) {
		const componentPadRefs = Array.isArray(component?.pads) ? component.pads : [];
		const resolvedPads = componentPadRefs
			.map((padReference) => {
				const reference = padReference as { padNumber?: unknown } | undefined;
				const padNumber = typeof reference?.padNumber === 'string' ? reference.padNumber : undefined;
				if (!padNumber)
					return undefined;

				return findResolvedPcbPad(componentPrimitiveId, padNumber, component, allPads);
			})
			.filter((pad): pad is IPCB_PrimitiveComponentPad => Boolean(pad));

		if (resolvedPads.length > 0)
			return resolvedPads;
	}

	return await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(componentPrimitiveId) ?? [];
}

async function listRecoverablePcbComponentPrimitiveIds(
	layer: TPCB_LayersOfComponent,
	primitiveLock?: boolean,
): Promise<string[]> {
	return await eda.pcb_PrimitiveComponent.getAllPrimitiveId(layer, primitiveLock) ?? [];
}

async function recoverCreatedPcbComponentFromHostError(
	previousPrimitiveIds: string[],
	layer: TPCB_LayersOfComponent,
	primitiveLock?: boolean,
): Promise<unknown | undefined> {
	try {
		const nextPrimitiveIds = await listRecoverablePcbComponentPrimitiveIds(layer, primitiveLock);
		const addedPrimitiveIds = findAddedPrimitiveIds(previousPrimitiveIds, nextPrimitiveIds);
		if (addedPrimitiveIds.length !== 1)
			return undefined;

		return await eda.pcb_Primitive.getPrimitiveByPrimitiveId(addedPrimitiveIds[0]);
	}
	catch {
		return undefined;
	}
}

async function createNetLabelForPin(
	pin: ISCH_PrimitiveComponentPin,
	net: string,
	labelOffsetX?: number,
	labelOffsetY?: number,
): Promise<unknown> {
	return getSchematicAttributeApi().createNetLabel(
		pin.getState_X() + (labelOffsetX ?? 0),
		pin.getState_Y() + (labelOffsetY ?? 0),
		net,
	);
}

async function createSchematicPinNetAttachment(
	pin: ISCH_PrimitiveComponentPin,
	net: string,
	labelOffsetX?: number,
	labelOffsetY?: number,
): Promise<{ primitive: unknown; kind: 'net-label' | 'wire-stub'; fallbackUsed: boolean }> {
	const attributeApi = getSchematicAttributeApiIfAvailable();
	if (attributeApi?.createNetLabel) {
		return {
			primitive: await createNetLabelForPin(pin, net, labelOffsetX, labelOffsetY),
			kind: 'net-label',
			fallbackUsed: false,
		};
	}

	return {
		primitive: await createSchematicWireStubForPin(pin, net, labelOffsetX, labelOffsetY),
		kind: 'wire-stub',
		fallbackUsed: true,
	};
}

async function createSchematicWireStubForPin(
	pin: ISCH_PrimitiveComponentPin,
	net: string,
	labelOffsetX?: number,
	labelOffsetY?: number,
): Promise<unknown> {
	const [startX, startY, endX, endY] = buildSchematicPinStubLine(pin, labelOffsetX, labelOffsetY);
	return eda.sch_PrimitiveWire.create([startX, startY, endX, endY], net);
}

function getSchematicAttributeApi(): typeof eda.sch_PrimitiveAttribute {
	assertSchematicNetLabelCapability();
	const attributeApi = getSchematicAttributeApiIfAvailable();
	if (!attributeApi)
		throw new Error('This EasyEDA runtime does not expose sch_PrimitiveAttribute. Net-label creation and modification are unavailable on this host build. Use wire- or source-based editing instead.');

	if (typeof attributeApi.createNetLabel !== 'function')
		throw new Error('This EasyEDA runtime does not expose sch_PrimitiveAttribute.createNetLabel. Net-label creation is unavailable on this host build. Use connect_schematic_pin_to_net or connect_schematic_pins_to_nets to fall back to wire-stub net attachment, or use wire- or source-based editing instead.');

	return attributeApi;
}

function assertSchematicNetLabelCapability(): void {
	const capabilitySummary = getSchematicNetLabelCapabilitySummary(getSchematicAttributeApiIfAvailable());
	if (!capabilitySummary.supported)
		throw new Error(`${capabilitySummary.warning} See get_capabilities.hostRuntimeUnsupportedMethods and get_capabilities.hostRuntimeCapabilities for live host support details.`);
}

function getSchematicAttributeApiIfAvailable(): (typeof eda.sch_PrimitiveAttribute & { createNetLabel?: typeof eda.sch_PrimitiveAttribute.createNetLabel }) | undefined {
	const attributeApi = (eda as typeof eda & {
		sch_PrimitiveAttribute?: typeof eda.sch_PrimitiveAttribute;
	}).sch_PrimitiveAttribute;
	return attributeApi;
}

function serializeSchematicPin(pin: ISCH_PrimitiveComponentPin): Record<string, unknown> {
	return {
		primitiveId: callPinGetter(pin, 'getState_PrimitiveId') ?? getRecordValue(pin, 'primitiveId'),
		x: callPinGetter(pin, 'getState_X') ?? getRecordValue(pin, 'x'),
		y: callPinGetter(pin, 'getState_Y') ?? getRecordValue(pin, 'y'),
		pinNumber: callPinGetter(pin, 'getState_PinNumber') ?? getRecordValue(pin, 'pinNumber'),
		pinName: callPinGetter(pin, 'getState_PinName') ?? getRecordValue(pin, 'pinName'),
		rotation: callPinGetter(pin, 'getState_Rotation') ?? getRecordValue(pin, 'rotation'),
		pinLength: callPinGetter(pin, 'getState_PinLength') ?? getRecordValue(pin, 'pinLength'),
		pinColor: callPinGetter(pin, 'getState_PinColor') ?? getRecordValue(pin, 'pinColor'),
		pinShape: callPinGetter(pin, 'getState_PinShape') ?? getRecordValue(pin, 'pinShape'),
		pinType: callPinGetter(pin, 'getState_pinType') ?? callPinGetter(pin, 'getState_PinType') ?? getRecordValue(pin, 'pinType'),
		noConnected: getSchematicPinNoConnected(pin),
	};
}

async function setSchematicPinNoConnected(pin: ISCH_PrimitiveComponentPin, noConnected: boolean): Promise<ISCH_PrimitiveComponentPin> {
	const mutablePin = pin as ISCH_PrimitiveComponentPin & {
		setState_NoConnected?: (value: boolean) => { done?: () => Promise<ISCH_PrimitiveComponentPin> };
		done?: () => Promise<ISCH_PrimitiveComponentPin>;
	};
	if (typeof mutablePin.setState_NoConnected !== 'function')
		throw new Error('This EasyEDA runtime does not expose setState_NoConnected on schematic pin objects. No-connect editing is unavailable on this host build.');

	const pendingPin = mutablePin.setState_NoConnected(noConnected);
	if (!pendingPin || typeof pendingPin.done !== 'function')
		throw new Error('This EasyEDA runtime returned a schematic pin object without a done() method after setState_NoConnected. No-connect editing is unavailable on this host build.');

	return await pendingPin.done();
}

function getSchematicPinNoConnected(pin: ISCH_PrimitiveComponentPin): boolean | undefined {
	const noConnected = callPinGetter(pin, 'getState_NoConnected');
	if (typeof noConnected === 'boolean')
		return noConnected;

	const fallbackValue = getRecordValue(pin, 'noConnected');
	return typeof fallbackValue === 'boolean' ? fallbackValue : undefined;
}

function callPinGetter(pin: ISCH_PrimitiveComponentPin, methodName: string): unknown {
	const candidate = pin as ISCH_PrimitiveComponentPin & Record<string, unknown>;
	const method = candidate[methodName];
	if (typeof method !== 'function')
		return undefined;

	return (method as () => unknown).call(pin);
}

function getRecordValue(pin: ISCH_PrimitiveComponentPin, key: string): unknown {
	const candidate = pin as ISCH_PrimitiveComponentPin & Record<string, unknown>;
	return candidate[key];
}

function serializePcbPad(pad: IPCB_PrimitiveComponentPad, parentComponentPrimitiveId?: string): Record<string, unknown> {
	const parentComponentId = typeof (pad as IPCB_PrimitiveComponentPad & { getState_ParentComponentPrimitiveId?: () => unknown }).getState_ParentComponentPrimitiveId === 'function'
		? (pad as IPCB_PrimitiveComponentPad & { getState_ParentComponentPrimitiveId: () => unknown }).getState_ParentComponentPrimitiveId()
		: undefined;

	return {
		primitiveId: pad.getState_PrimitiveId(),
		parentComponentPrimitiveId: typeof parentComponentId === 'string' ? parentComponentId : parentComponentPrimitiveId,
		layer: pad.getState_Layer(),
		padNumber: pad.getState_PadNumber(),
		x: pad.getState_X(),
		y: pad.getState_Y(),
		rotation: pad.getState_Rotation(),
		net: pad.getState_Net(),
		padType: pad.getState_PadType(),
		primitiveLock: pad.getState_PrimitiveLock(),
	};
}

async function createPcbLineSegment(
	net: string,
	layer: TPCB_LayersOfLine,
	start: { x: number; y: number },
	end: { x: number; y: number },
	lineWidth?: number,
	primitiveLock?: boolean,
): Promise<unknown> {
	const hostLayer = normalizePcbLineLayerForHost(layer) as TPCB_LayersOfLine;

	return eda.pcb_PrimitiveLine.create(
		net,
		hostLayer,
		start.x,
		start.y,
		end.x,
		end.y,
		lineWidth,
		primitiveLock,
	);
}

function buildShiftedPinLabel(pinNumber: string, pinOffset: number): string {
	if (pinOffset === 0)
		return pinNumber;

	const numericPin = Number(pinNumber);
	if (!Number.isNaN(numericPin) && Number.isFinite(numericPin))
		return String(numericPin + pinOffset);

	return `${pinNumber}${pinOffset >= 0 ? '+' : ''}${pinOffset}`;
}

function getRouteNet(
	fromPad: IPCB_PrimitiveComponentPad,
	toPad: IPCB_PrimitiveComponentPad,
	explicitNet?: string,
): string {
	if (explicitNet)
		return explicitNet;

	const fromNet = fromPad.getState_Net();
	const toNet = toPad.getState_Net();
	if (fromNet && toNet && fromNet !== toNet)
		throw new Error(`Pad nets do not match: ${fromNet} !== ${toNet}. Provide an explicit net to override.`);

	const net = fromNet ?? toNet;
	if (!net)
		throw new Error('Neither pad has a net. Provide an explicit net for the route.');

	return net;
}

function getRequiredObjectArray(value: unknown, key: string): Array<Record<string, unknown>> {
	if (!Array.isArray(value) || value.length === 0)
		throw new Error(`Expected a non-empty object array for ${key}`);

	const items = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
	if (items.length !== value.length)
		throw new Error(`Expected every item in ${key} to be an object`);

	return items;
}

function getRequiredWaypointArray(value: unknown, key: string): Array<{ x: number; y: number }> {
	const items = getRequiredObjectArray(value, key);
	return items.map((item, index) => ({
		x: getRequiredNumber(item.x, `${key}[${index}].x`),
		y: getRequiredNumber(item.y, `${key}[${index}].y`),
	}));
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error)
		return error.message;

	return String(error);
}

function logInfo(message: string): void {
	try {
		eda.sys_Log.add(message);
	}
	catch {
		console.warn(message);
	}
}
