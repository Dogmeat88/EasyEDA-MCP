export const BRIDGE_PROTOCOL_VERSION = 1;
export const DEFAULT_BRIDGE_HOST = '127.0.0.1';
export const DEFAULT_BRIDGE_PORT = 19732;
export const DEFAULT_BRIDGE_PATH = '/easyeda-mcp';
export const DEFAULT_BRIDGE_ENDPOINT = `ws://${DEFAULT_BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}${DEFAULT_BRIDGE_PATH}`;

export const MCP_BRIDGE_CONFIG_KEY = 'easyeda.mcpBridge';
export const MCP_BRIDGE_SOCKET_ID = 'easyeda-mcp-bridge';

export type BridgeMethod
	= 'get_capabilities'
		| 'ping_bridge'
		| 'echo_bridge'
		| 'search_library_devices'
		| 'get_current_context'
		| 'list_project_objects'
		| 'open_document'
		| 'save_active_document'
		| 'create_board'
		| 'create_pcb'
		| 'import_schematic_to_pcb'
		| 'create_panel'
		| 'create_schematic'
		| 'create_schematic_page'
		| 'copy_board'
		| 'copy_pcb'
		| 'copy_panel'
		| 'copy_schematic'
		| 'copy_schematic_page'
		| 'add_schematic_component'
		| 'modify_schematic_component'
		| 'delete_schematic_component'
		| 'add_schematic_net_flag'
		| 'add_schematic_net_port'
		| 'add_schematic_short_circuit_flag'
		| 'list_schematic_component_pins'
		| 'set_schematic_pin_no_connect'
		| 'connect_schematic_pin_to_net'
		| 'connect_schematic_pins_to_nets'
		| 'connect_schematic_pins_with_prefix'
		| 'add_schematic_text'
		| 'add_schematic_net_label'
		| 'add_schematic_wire'
		| 'list_schematic_primitive_ids'
		| 'get_schematic_primitive'
		| 'get_schematic_primitives_bbox'
		| 'add_pcb_component'
		| 'modify_pcb_component'
		| 'delete_pcb_component'
		| 'list_pcb_component_pads'
		| 'route_pcb_line_between_component_pads'
		| 'route_pcb_lines_between_component_pads'
		| 'add_pcb_line'
		| 'add_pcb_text'
		| 'list_pcb_primitive_ids'
		| 'get_pcb_primitive'
		| 'get_pcb_primitives_bbox'
		| 'list_pcb_nets'
		| 'run_pcb_drc'
		| 'get_pcb_net'
		| 'set_pcb_net_color'
		| 'get_pcb_net_primitives'
		| 'modify_schematic_text'
		| 'delete_schematic_text'
		| 'modify_schematic_net_label'
		| 'modify_schematic_wire'
		| 'delete_schematic_wire'
		| 'modify_pcb_line'
		| 'delete_pcb_line'
		| 'modify_pcb_text'
		| 'delete_pcb_text'
		| 'rename_board'
		| 'rename_pcb'
		| 'rename_schematic'
		| 'rename_schematic_page'
		| 'rename_panel'
		| 'delete_board'
		| 'delete_pcb'
		| 'delete_schematic'
		| 'delete_schematic_page'
		| 'delete_panel'
		| 'get_document_source'
		| 'set_document_source';

export interface BridgeEnvelopeBase {
	protocolVersion: number;
	requestId?: string;
}

export interface BridgeHelloEnvelope extends BridgeEnvelopeBase {
	type: 'hello';
	role: 'extension' | 'server';
	payload: Record<string, unknown>;
}

export interface BridgeRequestEnvelope extends BridgeEnvelopeBase {
	type: 'request';
	requestId: string;
	method: BridgeMethod;
	params?: Record<string, unknown>;
}

export interface BridgeResponseEnvelope extends BridgeEnvelopeBase {
	type: 'response';
	requestId: string;
	ok: boolean;
	result?: unknown;
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};
}

export type BridgeEnvelope = BridgeHelloEnvelope | BridgeRequestEnvelope | BridgeResponseEnvelope;

export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
	if (!value || typeof value !== 'object')
		return false;

	const candidate = value as Partial<BridgeEnvelope>;
	return candidate.protocolVersion === BRIDGE_PROTOCOL_VERSION && typeof candidate.type === 'string';
}

export function createServerHello(payload: Record<string, unknown>): BridgeHelloEnvelope {
	return {
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		type: 'hello',
		role: 'server',
		payload,
	};
}

export function createExtensionHello(payload: Record<string, unknown>): BridgeHelloEnvelope {
	return {
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		type: 'hello',
		role: 'extension',
		payload,
	};
}

export function createBridgeResponse(requestId: string, result: unknown): BridgeResponseEnvelope {
	return {
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		type: 'response',
		requestId,
		ok: true,
		result,
	};
}

export function createBridgeError(
	requestId: string,
	code: string,
	message: string,
	details?: unknown,
): BridgeResponseEnvelope {
	return {
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		type: 'response',
		requestId,
		ok: false,
		error: {
			code,
			message,
			details,
		},
	};
}

export function serializeBridgeEnvelope(message: BridgeEnvelope): string {
	return JSON.stringify(message);
}

export function parseBridgeEnvelope(raw: string): BridgeEnvelope | undefined {
	try {
		const parsed = JSON.parse(raw) as unknown;
		return isBridgeEnvelope(parsed) ? parsed : undefined;
	}
	catch {
		return undefined;
	}
}

export function computeSourceRevision(source: string): string {
	let hash = 2166136261;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	const hexHash = (hash >>> 0).toString(16).padStart(8, '0');
	return `${source.length}:${hexHash}`;
}
