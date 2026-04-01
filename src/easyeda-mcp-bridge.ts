import type { BridgeMethod, BridgeRequestEnvelope } from './mcp-bridge-protocol';

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

interface BridgeState {
	endpoint: string;
	started: boolean;
	connected: boolean;
	connectAttempts: number;
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

export async function startEasyedaMcpBridge(forceReconnect = false): Promise<void> {
	hydratePersistedBridgeState();
	bridgeState.endpoint = getBridgeEndpoint();
	if (bridgeState.started && !forceReconnect)
		return;

	bridgeState.started = true;
	bridgeState.connected = false;
	bridgeState.connectAttempts += 1;
	bridgeState.lastAttemptAt = Date.now();
	bridgeState.lastEvent = forceReconnect ? 'reconnecting websocket client' : 'registering websocket client';
	bridgeState.lastError = undefined;
	void persistBridgeState();
	clearPendingConnectionDiagnosticTimer();

	if (forceReconnect) {
		try {
			eda.sys_WebSocket.close(MCP_BRIDGE_SOCKET_ID);
			bridgeState.lastEvent = 'closed previous websocket before reconnect';
			void persistBridgeState();
		}
		catch {
			// Ignore close errors when reconnecting.
		}
	}

	try {
		eda.sys_WebSocket.register(
			MCP_BRIDGE_SOCKET_ID,
			bridgeState.endpoint,
			async (event) => {
				const rawMessage = typeof event.data === 'string' ? event.data : undefined;
				if (!rawMessage)
					return;

				bridgeState.lastEvent = 'received websocket message';
				await handleSocketMessage(rawMessage);
			},
			async () => {
				clearPendingConnectionDiagnosticTimer();
				bridgeState.connected = true;
				bridgeState.lastConnectedAt = Date.now();
				bridgeState.lastEvent = 'websocket connected';
				bridgeState.lastError = undefined;
				void persistBridgeState();
				sendSocketMessage(createExtensionHello(await getHelloPayload()));
			},
		);
		scheduleConnectionDiagnostic();
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
		`Endpoint: ${state.endpoint}`,
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
		extensionVersion: '1.0.0',
		endpoint: bridgeState.endpoint,
		methods: getSupportedMethods(),
	};
}

function getCapabilities(): Record<string, unknown> {
	return {
		bridgeEndpoint: bridgeState.endpoint,
		connected: bridgeState.connected,
		supportedMethods: getSupportedMethods(),
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
	const [currentDocument, currentProject] = await Promise.all([
		eda.dmt_SelectControl.getCurrentDocumentInfo(),
		eda.dmt_Project.getCurrentProjectInfo(),
	]);

	return {
		currentDocument,
		currentProject,
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

	return {
		pcbUuid,
		boardName,
	};
}

async function createBoard(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const schematicUuid = getOptionalString(params.schematicUuid);
	const pcbUuid = getOptionalString(params.pcbUuid);
	const boardName = await eda.dmt_Board.createBoard(schematicUuid, pcbUuid);

	return {
		boardName,
		schematicUuid,
		pcbUuid,
	};
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
	const primitive = await createNetLabelForPin(pin, net, getOptionalNumber(params.labelOffsetX), getOptionalNumber(params.labelOffsetY));
	const saved = await saveSchematicDocumentIfRequested(getOptionalBoolean(params.saveAfter));

	return {
		componentPrimitiveId,
		pin: serializeSchematicPin(pin),
		net,
		primitive,
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
		const primitive = await createNetLabelForPin(pin, net, getOptionalNumber(connection.labelOffsetX), getOptionalNumber(connection.labelOffsetY));
		results.push({
			pin: serializeSchematicPin(pin),
			net,
			primitive,
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
		const primitive = await createNetLabelForPin(pin, net, labelOffsetX, labelOffsetY);
		results.push({
			pin: serializeSchematicPin(pin),
			net,
			primitive,
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
	const primitive = await eda.pcb_PrimitiveComponent.create(
		getRequiredDeviceReference(params),
		getRequiredString(params.layer, 'layer') as TPCB_LayersOfComponent,
		getRequiredNumber(params.x, 'x'),
		getRequiredNumber(params.y, 'y'),
		getOptionalNumber(params.rotation),
		getOptionalBoolean(params.primitiveLock),
	);
	const saved = await savePcbDocumentIfRequested(currentDocument.uuid, getOptionalBoolean(params.saveAfter));

	return {
		primitive,
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
	const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(componentPrimitiveId) ?? [];

	return {
		componentPrimitiveId,
		count: pads.length,
		pads: pads.map(pad => serializePcbPad(pad)),
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
	const primitives: unknown[] = [];

	for (let index = 0; index < points.length - 1; index += 1) {
		primitives.push(await createPcbLineSegment(
			net,
			layer,
			points[index],
			points[index + 1],
			getOptionalNumber(params.lineWidth),
			getOptionalBoolean(params.primitiveLock),
		));
	}

	const saved = await savePcbDocumentIfRequested(currentDocument.uuid, getOptionalBoolean(params.saveAfter));
	return {
		fromPad: serializePcbPad(fromPad),
		toPad: serializePcbPad(toPad),
		layer,
		net,
		waypoints,
		segmentCount: primitives.length,
		primitives,
		saved,
	};
}

async function addSchematicNetLabel(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	await requireCurrentDocumentType(EDMT_EditorDocumentType.SCHEMATIC_PAGE, 'Schematic page required for schematic net label');
	const x = getRequiredNumber(params.x, 'x');
	const y = getRequiredNumber(params.y, 'y');
	const net = getRequiredString(params.net, 'net');
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
	const primitive = await eda.pcb_PrimitiveString.create(
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
	const net = getRequiredString(params.net, 'net');
	const layer = getRequiredString(params.layer, 'layer') as TPCB_LayersOfLine;
	const startX = getRequiredNumber(params.startX, 'startX');
	const startY = getRequiredNumber(params.startY, 'startY');
	const endX = getRequiredNumber(params.endX, 'endX');
	const endY = getRequiredNumber(params.endY, 'endY');
	const primitive = await eda.pcb_PrimitiveLine.create(
		net,
		layer,
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
			primitiveIds = await eda.pcb_PrimitiveString.getAllPrimitiveId(
				getOptionalString(params.layer) as TPCB_LayersOfImage | undefined,
				getOptionalBoolean(params.primitiveLock),
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
	const primitive = await eda.pcb_PrimitiveLine.modify(primitiveId, {
		net: getOptionalString(params.net),
		layer: getOptionalString(params.layer) as TPCB_LayersOfLine | undefined,
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
	const primitive = await eda.pcb_PrimitiveString.modify(primitiveId, {
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
	});
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
	const deleted = await eda.pcb_PrimitiveString.delete(primitiveId);
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
	const currentDocument = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	if (!currentDocument)
		throw new Error('No active EasyEDA document is focused');

	return currentDocument;
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
	if (typeof persistedState.started === 'boolean')
		bridgeState.started = persistedState.started;
	if (typeof persistedState.connected === 'boolean')
		bridgeState.connected = persistedState.connected;
	if (typeof persistedState.connectAttempts === 'number' && Number.isFinite(persistedState.connectAttempts))
		bridgeState.connectAttempts = persistedState.connectAttempts;
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

function sendSocketMessage(message: ReturnType<typeof createBridgeResponse> | ReturnType<typeof createBridgeError> | ReturnType<typeof createExtensionHello>): void {
	try {
		eda.sys_WebSocket.send(MCP_BRIDGE_SOCKET_ID, serializeBridgeEnvelope(message));
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

function scheduleConnectionDiagnostic(): void {
	clearPendingConnectionDiagnosticTimer();
	pendingConnectionDiagnosticTimer = setTimeout(() => {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
	const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(componentPrimitiveId) ?? [];
	const pad = pads.find(candidate => candidate.getState_PadNumber() === padNumber);
	if (!pad)
		throw new Error(`Unable to find PCB pad ${padNumber} on component ${componentPrimitiveId}`);

	return pad;
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

function getSchematicAttributeApi(): typeof eda.sch_PrimitiveAttribute {
	const attributeApi = (eda as typeof eda & {
		sch_PrimitiveAttribute?: typeof eda.sch_PrimitiveAttribute;
	}).sch_PrimitiveAttribute;
	if (!attributeApi)
		throw new Error('This EasyEDA runtime does not expose sch_PrimitiveAttribute. Net-label creation and modification are unavailable on this host build. Use wire- or source-based editing instead.');

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

function serializePcbPad(pad: IPCB_PrimitiveComponentPad): Record<string, unknown> {
	return {
		primitiveId: pad.getState_PrimitiveId(),
		parentComponentPrimitiveId: pad.getState_ParentComponentPrimitiveId(),
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
	return eda.pcb_PrimitiveLine.create(
		net,
		layer,
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
