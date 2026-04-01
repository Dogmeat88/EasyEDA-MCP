import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BridgeMethod } from './mcp-bridge-protocol';

import { z } from 'zod';
import { computeSourceRevision } from './mcp-bridge-protocol';

const scalarRecordSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
const unknownRecordSchema = z.record(z.string(), z.unknown());

export interface EasyedaBridgeCaller {
	call: (method: BridgeMethod, params?: Record<string, unknown>) => Promise<unknown>;
	getConnectionState: () => Record<string, unknown>;
}

export type ToolRegistrar = Pick<McpServer, 'registerTool'>;

export const openDocumentInputSchema = z.object({
	documentUuid: z.string().min(1),
	splitScreenId: z.string().min(1).optional(),
});

export const echoBridgeInputSchema = z.object({
	message: z.string(),
});

export const createDocumentInputSchema = z.object({
	boardName: z.string().min(1).optional(),
});

export const createBoardInputSchema = z.object({
	schematicUuid: z.string().min(1).optional(),
	pcbUuid: z.string().min(1).optional(),
});

export const createSchematicPageInputSchema = z.object({
	schematicUuid: z.string().min(1),
});

export const copyBoardInputSchema = z.object({
	sourceBoardName: z.string().min(1),
});

export const copyPcbInputSchema = z.object({
	pcbUuid: z.string().min(1),
	boardName: z.string().min(1).optional(),
});

export const copyPanelInputSchema = z.object({
	panelUuid: z.string().min(1),
});

export const copySchematicInputSchema = z.object({
	schematicUuid: z.string().min(1),
	boardName: z.string().min(1).optional(),
});

export const copySchematicPageInputSchema = z.object({
	schematicPageUuid: z.string().min(1),
	schematicUuid: z.string().min(1).optional(),
});

export const searchLibraryDevicesInputSchema = z.object({
	query: z.string().min(1).optional(),
	lcscIds: z.array(z.string().min(1)).min(1).optional(),
	libraryUuid: z.string().min(1).optional(),
	itemsPerPage: z.number().int().positive().optional(),
	page: z.number().int().positive().optional(),
	allowMultiMatch: z.boolean().optional(),
}).refine(
	({ query, lcscIds }) => Boolean(query) || Boolean(lcscIds?.length),
	'Provide query or lcscIds',
);

export const addSchematicComponentInputSchema = z.object({
	libraryUuid: z.string().min(1),
	deviceUuid: z.string().min(1),
	x: z.number(),
	y: z.number(),
	subPartName: z.string().min(1).optional(),
	rotation: z.number().optional(),
	mirror: z.boolean().optional(),
	addIntoBom: z.boolean().optional(),
	addIntoPcb: z.boolean().optional(),
	saveAfter: z.boolean().optional(),
});

export const modifySchematicComponentInputSchema = z.object({
	primitiveId: z.string().min(1),
	x: z.number().optional(),
	y: z.number().optional(),
	rotation: z.number().optional(),
	mirror: z.boolean().optional(),
	addIntoBom: z.boolean().optional(),
	addIntoPcb: z.boolean().optional(),
	designator: z.string().optional().nullable(),
	name: z.string().optional().nullable(),
	uniqueId: z.string().optional().nullable(),
	manufacturer: z.string().optional().nullable(),
	manufacturerId: z.string().optional().nullable(),
	supplier: z.string().optional().nullable(),
	supplierId: z.string().optional().nullable(),
	otherProperty: scalarRecordSchema.optional(),
	saveAfter: z.boolean().optional(),
});

export const addSchematicNetFlagInputSchema = z.object({
	identification: z.enum(['Power', 'Ground', 'AnalogGround', 'ProtectGround']),
	net: z.string().min(1),
	x: z.number(),
	y: z.number(),
	rotation: z.number().optional(),
	mirror: z.boolean().optional(),
	saveAfter: z.boolean().optional(),
});

export const addSchematicNetPortInputSchema = z.object({
	direction: z.enum(['IN', 'OUT', 'BI']),
	net: z.string().min(1),
	x: z.number(),
	y: z.number(),
	rotation: z.number().optional(),
	mirror: z.boolean().optional(),
	saveAfter: z.boolean().optional(),
});

export const addSchematicShortCircuitFlagInputSchema = z.object({
	x: z.number(),
	y: z.number(),
	rotation: z.number().optional(),
	mirror: z.boolean().optional(),
	saveAfter: z.boolean().optional(),
});

export const schematicComponentPinsInputSchema = z.object({
	componentPrimitiveId: z.string().min(1),
});

export const setSchematicPinNoConnectInputSchema = z.object({
	componentPrimitiveId: z.string().min(1),
	pinNumber: z.string().min(1),
	noConnected: z.boolean(),
	saveAfter: z.boolean().optional(),
});

export const connectSchematicPinToNetInputSchema = z.object({
	componentPrimitiveId: z.string().min(1),
	pinNumber: z.string().min(1),
	net: z.string().min(1),
	labelOffsetX: z.number().optional(),
	labelOffsetY: z.number().optional(),
	saveAfter: z.boolean().optional(),
});

export const connectSchematicPinsToNetsInputSchema = z.object({
	componentPrimitiveId: z.string().min(1),
	connections: z.array(z.object({
		pinNumber: z.string().min(1),
		net: z.string().min(1),
		labelOffsetX: z.number().optional(),
		labelOffsetY: z.number().optional(),
	})).min(1),
	saveAfter: z.boolean().optional(),
});

export const connectSchematicPinsWithPrefixInputSchema = z.object({
	componentPrimitiveId: z.string().min(1),
	pinNumbers: z.array(z.string().min(1)).min(1),
	netPrefix: z.string().min(1),
	separator: z.string().optional(),
	pinOffset: z.number().int().optional(),
	labelOffsetX: z.number().optional(),
	labelOffsetY: z.number().optional(),
	saveAfter: z.boolean().optional(),
});

export const addSchematicTextInputSchema = z.object({
	x: z.number(),
	y: z.number(),
	content: z.string().min(1),
	rotation: z.number().optional(),
	textColor: z.string().optional().nullable(),
	fontName: z.string().optional().nullable(),
	fontSize: z.number().optional().nullable(),
	bold: z.boolean().optional(),
	italic: z.boolean().optional(),
	underLine: z.boolean().optional(),
	alignMode: z.number().optional(),
	saveAfter: z.boolean().optional(),
});

export const addSchematicNetLabelInputSchema = z.object({
	x: z.number(),
	y: z.number(),
	net: z.string().min(1),
	saveAfter: z.boolean().optional(),
});

export const addSchematicWireInputSchema = z.object({
	line: z.union([
		z.array(z.number()),
		z.array(z.array(z.number())),
	]),
	net: z.string().optional(),
	color: z.string().optional().nullable(),
	lineWidth: z.number().optional().nullable(),
	lineType: z.number().optional(),
	saveAfter: z.boolean().optional(),
});

export const addPcbLineInputSchema = z.object({
	net: z.string().min(1),
	layer: z.string().min(1),
	startX: z.number(),
	startY: z.number(),
	endX: z.number(),
	endY: z.number(),
	lineWidth: z.number().optional(),
	primitiveLock: z.boolean().optional(),
	saveAfter: z.boolean().optional(),
});

export const addPcbComponentInputSchema = z.object({
	libraryUuid: z.string().min(1),
	deviceUuid: z.string().min(1),
	layer: z.string().min(1),
	x: z.number(),
	y: z.number(),
	rotation: z.number().optional(),
	primitiveLock: z.boolean().optional(),
	saveAfter: z.boolean().optional(),
});

export const pcbComponentPadsInputSchema = z.object({
	componentPrimitiveId: z.string().min(1),
});

export const routePcbLineBetweenComponentPadsInputSchema = z.object({
	fromComponentPrimitiveId: z.string().min(1),
	fromPadNumber: z.string().min(1),
	toComponentPrimitiveId: z.string().min(1),
	toPadNumber: z.string().min(1),
	layer: z.string().min(1),
	net: z.string().min(1).optional(),
	lineWidth: z.number().optional(),
	primitiveLock: z.boolean().optional(),
	saveAfter: z.boolean().optional(),
});

export const routePcbLinesBetweenComponentPadsInputSchema = z.object({
	fromComponentPrimitiveId: z.string().min(1),
	fromPadNumber: z.string().min(1),
	toComponentPrimitiveId: z.string().min(1),
	toPadNumber: z.string().min(1),
	layer: z.string().min(1),
	net: z.string().min(1).optional(),
	waypoints: z.array(z.object({
		x: z.number(),
		y: z.number(),
	})).min(1),
	lineWidth: z.number().optional(),
	primitiveLock: z.boolean().optional(),
	saveAfter: z.boolean().optional(),
});

export const addPcbTextInputSchema = z.object({
	layer: z.string().min(1),
	x: z.number(),
	y: z.number(),
	text: z.string().min(1),
	fontFamily: z.string().min(1),
	fontSize: z.number().positive(),
	lineWidth: z.number().positive(),
	alignMode: z.number().optional(),
	rotation: z.number().optional(),
	reverse: z.boolean().optional(),
	expansion: z.number().optional(),
	mirror: z.boolean().optional(),
	primitiveLock: z.boolean().optional(),
	saveAfter: z.boolean().optional(),
});

export const modifySchematicTextInputSchema = z.object({
	primitiveId: z.string().min(1),
	x: z.number().optional(),
	y: z.number().optional(),
	content: z.string().min(1).optional(),
	rotation: z.number().optional(),
	textColor: z.string().optional().nullable(),
	fontName: z.string().optional().nullable(),
	fontSize: z.number().optional().nullable(),
	bold: z.boolean().optional(),
	italic: z.boolean().optional(),
	underLine: z.boolean().optional(),
	alignMode: z.number().optional(),
	saveAfter: z.boolean().optional(),
});

export const deletePrimitiveInputSchema = z.object({
	primitiveId: z.string().min(1),
	saveAfter: z.boolean().optional(),
	skipConfirmation: z.boolean().optional(),
});

export const modifySchematicNetLabelInputSchema = z.object({
	primitiveId: z.string().min(1),
	x: z.number().optional().nullable(),
	y: z.number().optional().nullable(),
	rotation: z.number().optional().nullable(),
	color: z.string().optional().nullable(),
	fontName: z.string().optional().nullable(),
	fontSize: z.number().optional().nullable(),
	bold: z.boolean().optional().nullable(),
	italic: z.boolean().optional().nullable(),
	underLine: z.boolean().optional().nullable(),
	alignMode: z.number().optional().nullable(),
	fillColor: z.string().optional().nullable(),
	net: z.string().min(1).optional(),
	keyVisible: z.boolean().optional().nullable(),
	valueVisible: z.boolean().optional().nullable(),
	saveAfter: z.boolean().optional(),
});

export const modifySchematicWireInputSchema = z.object({
	primitiveId: z.string().min(1),
	line: z.union([
		z.array(z.number()),
		z.array(z.array(z.number())),
	]).optional(),
	net: z.string().optional(),
	color: z.string().optional().nullable(),
	lineWidth: z.number().optional().nullable(),
	lineType: z.number().optional().nullable(),
	saveAfter: z.boolean().optional(),
});

export const modifyPcbLineInputSchema = z.object({
	primitiveId: z.string().min(1),
	net: z.string().min(1).optional(),
	layer: z.string().min(1).optional(),
	startX: z.number().optional(),
	startY: z.number().optional(),
	endX: z.number().optional(),
	endY: z.number().optional(),
	lineWidth: z.number().optional(),
	primitiveLock: z.boolean().optional(),
	saveAfter: z.boolean().optional(),
});

export const modifyPcbTextInputSchema = z.object({
	primitiveId: z.string().min(1),
	layer: z.string().min(1).optional(),
	x: z.number().optional(),
	y: z.number().optional(),
	text: z.string().min(1).optional(),
	fontFamily: z.string().min(1).optional(),
	fontSize: z.number().positive().optional(),
	lineWidth: z.number().positive().optional(),
	alignMode: z.number().optional(),
	rotation: z.number().optional(),
	reverse: z.boolean().optional(),
	expansion: z.number().optional(),
	mirror: z.boolean().optional(),
	primitiveLock: z.boolean().optional(),
	saveAfter: z.boolean().optional(),
});

export const modifyPcbComponentInputSchema = z.object({
	primitiveId: z.string().min(1),
	layer: z.string().min(1).optional(),
	x: z.number().optional(),
	y: z.number().optional(),
	rotation: z.number().optional(),
	primitiveLock: z.boolean().optional(),
	addIntoBom: z.boolean().optional(),
	designator: z.string().optional().nullable(),
	name: z.string().optional().nullable(),
	uniqueId: z.string().optional().nullable(),
	manufacturer: z.string().optional().nullable(),
	manufacturerId: z.string().optional().nullable(),
	supplier: z.string().optional().nullable(),
	supplierId: z.string().optional().nullable(),
	otherProperty: unknownRecordSchema.optional(),
	saveAfter: z.boolean().optional(),
});

export const listSchematicPrimitiveIdsInputSchema = z.object({
	family: z.enum(['text', 'wire', 'component']),
	net: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
	componentType: z.number().int().optional(),
	allSchematicPages: z.boolean().optional(),
});

export const listPcbPrimitiveIdsInputSchema = z.object({
	family: z.enum(['line', 'text', 'component']),
	net: z.string().min(1).optional(),
	layer: z.string().min(1).optional(),
	primitiveLock: z.boolean().optional(),
});

export const primitiveByIdInputSchema = z.object({
	primitiveId: z.string().min(1),
});

export const primitivesBBoxInputSchema = z.object({
	primitiveIds: z.array(z.string().min(1)).min(1),
});

export const getPcbNetInputSchema = z.object({
	net: z.string().min(1),
});

export const setPcbNetColorInputSchema = z.object({
	net: z.string().min(1),
	color: z.object({
		r: z.number(),
		g: z.number(),
		b: z.number(),
		alpha: z.number(),
	}).nullable(),
});

export const getPcbNetPrimitivesInputSchema = z.object({
	net: z.string().min(1),
	primitiveTypes: z.array(z.number().int()).min(1).optional(),
});

export const renameBoardInputSchema = z.object({
	originalBoardName: z.string().min(1),
	boardName: z.string().min(1),
});

export const renamePcbInputSchema = z.object({
	pcbUuid: z.string().min(1),
	pcbName: z.string().min(1),
});

export const renameSchematicInputSchema = z.object({
	schematicUuid: z.string().min(1),
	schematicName: z.string().min(1),
});

export const renameSchematicPageInputSchema = z.object({
	schematicPageUuid: z.string().min(1),
	schematicPageName: z.string().min(1),
});

export const renamePanelInputSchema = z.object({
	panelUuid: z.string().min(1),
	panelName: z.string().min(1),
});

export const deleteBoardInputSchema = z.object({
	boardName: z.string().min(1),
	skipConfirmation: z.boolean().optional(),
});

export const deletePcbInputSchema = z.object({
	pcbUuid: z.string().min(1),
	skipConfirmation: z.boolean().optional(),
});

export const deleteSchematicInputSchema = z.object({
	schematicUuid: z.string().min(1),
	skipConfirmation: z.boolean().optional(),
});

export const deleteSchematicPageInputSchema = z.object({
	schematicPageUuid: z.string().min(1),
	skipConfirmation: z.boolean().optional(),
});

export const deletePanelInputSchema = z.object({
	panelUuid: z.string().min(1),
	skipConfirmation: z.boolean().optional(),
});

export const setDocumentSourceInputSchema = z.object({
	source: z.string().min(1),
	expectedSourceHash: z.string().optional(),
	force: z.boolean().optional(),
	skipConfirmation: z.boolean().optional(),
}).refine(
	({ expectedSourceHash, force }) => Boolean(expectedSourceHash) || force === true,
	'Provide expectedSourceHash or force: true',
);

export const computeSourceRevisionInputSchema = z.object({
	source: z.string(),
});

export const easyedaToolNames = [
	'bridge_status',
	'get_usage_guide',
	'ping_bridge',
	'echo_bridge',
	'search_library_devices',
	'get_capabilities',
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
	'compute_source_revision',
] as const;

export function registerEasyedaTools(server: ToolRegistrar, bridgeSession: EasyedaBridgeCaller): void {
	server.registerTool(
		'bridge_status',
		{
			description: 'Inspect the current EasyEDA bridge connection state.',
		},
		async () => makeToolResult(enrichBridgeStatus(bridgeSession.getConnectionState())),
	);

	server.registerTool(
		'get_usage_guide',
		{
			description: 'Return a compact operational guide for choosing EasyEDA MCP tools, understanding common identifiers, and sequencing typical workflows.',
		},
		async () => makeToolResult(createUsageGuide()),
	);

	server.registerTool(
		'ping_bridge',
		{
			description: 'Round-trip a lightweight bridge health check through the EasyEDA extension.',
		},
		async () => makeToolResult(await bridgeSession.call('ping_bridge')),
	);

	server.registerTool(
		'echo_bridge',
		{
			description: 'Round-trip a message through the EasyEDA bridge to verify request and response flow.',
			inputSchema: echoBridgeInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('echo_bridge', args)),
	);

	server.registerTool(
		'search_library_devices',
		{
			description: 'Search EasyEDA library devices by keyword or LCSC part numbers.',
			inputSchema: searchLibraryDevicesInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('search_library_devices', args)),
	);

	server.registerTool(
		'get_capabilities',
		{
			description: 'Return the EasyEDA bridge capabilities reported by the extension.',
		},
		async () => makeToolResult(await bridgeSession.call('get_capabilities')),
	);

	server.registerTool(
		'get_current_context',
		{
			description: 'Return the active EasyEDA document and project context.',
		},
		async () => makeToolResult(enrichCurrentContext(await bridgeSession.call('get_current_context'))),
	);

	server.registerTool(
		'list_project_objects',
		{
			description: 'List boards, PCBs, schematics, schematic pages, and panels in the current project.',
		},
		async () => makeToolResult(await bridgeSession.call('list_project_objects')),
	);

	server.registerTool(
		'open_document',
		{
			description: 'Open a document in EasyEDA by UUID.',
			inputSchema: openDocumentInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('open_document', args)),
	);

	server.registerTool(
		'save_active_document',
		{
			description: 'Save the currently focused schematic page, PCB, or panel document.',
		},
		async () => makeToolResult(await bridgeSession.call('save_active_document')),
	);

	server.registerTool(
		'create_board',
		{
			description: 'Create a board in the active EasyEDA project, optionally linking an existing schematic and PCB.',
			inputSchema: createBoardInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('create_board', args)),
	);

	server.registerTool(
		'create_pcb',
		{
			description: 'Create a PCB in the active EasyEDA project.',
			inputSchema: createDocumentInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('create_pcb', args)),
	);

	server.registerTool(
		'create_panel',
		{
			description: 'Create a panel in the active EasyEDA project.',
		},
		async () => makeToolResult(await bridgeSession.call('create_panel')),
	);

	server.registerTool(
		'create_schematic',
		{
			description: 'Create a schematic in the active EasyEDA project.',
			inputSchema: createDocumentInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('create_schematic', args)),
	);

	server.registerTool(
		'create_schematic_page',
		{
			description: 'Create a schematic page under an existing schematic.',
			inputSchema: createSchematicPageInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('create_schematic_page', args)),
	);

	server.registerTool(
		'copy_board',
		{
			description: 'Copy an existing board by board name.',
			inputSchema: copyBoardInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('copy_board', args)),
	);

	server.registerTool(
		'copy_pcb',
		{
			description: 'Copy an existing PCB, optionally attaching the copy to a board.',
			inputSchema: copyPcbInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('copy_pcb', args)),
	);

	server.registerTool(
		'copy_panel',
		{
			description: 'Copy an existing panel by UUID.',
			inputSchema: copyPanelInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('copy_panel', args)),
	);

	server.registerTool(
		'copy_schematic',
		{
			description: 'Copy an existing schematic, optionally attaching the copy to a board.',
			inputSchema: copySchematicInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('copy_schematic', args)),
	);

	server.registerTool(
		'copy_schematic_page',
		{
			description: 'Copy an existing schematic page, optionally into a target schematic.',
			inputSchema: copySchematicPageInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('copy_schematic_page', args)),
	);

	server.registerTool(
		'add_schematic_component',
		{
			description: 'Place a library device as a component on the active schematic page.',
			inputSchema: addSchematicComponentInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('add_schematic_component', args)),
	);

	server.registerTool(
		'modify_schematic_component',
		{
			description: 'Modify a component primitive on the active schematic page.',
			inputSchema: modifySchematicComponentInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('modify_schematic_component', args)),
	);

	server.registerTool(
		'delete_schematic_component',
		{
			description: 'Delete a component primitive from the active schematic page. Set skipConfirmation to true to suppress the bridge-side delete prompt.',
			inputSchema: deletePrimitiveInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('delete_schematic_component', args)),
	);

	server.registerTool(
		'add_schematic_net_flag',
		{
			description: 'Place a power or ground net flag on the active schematic page.',
			inputSchema: addSchematicNetFlagInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('add_schematic_net_flag', args)),
	);

	server.registerTool(
		'add_schematic_net_port',
		{
			description: 'Place a net port component on the active schematic page.',
			inputSchema: addSchematicNetPortInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('add_schematic_net_port', args)),
	);

	server.registerTool(
		'add_schematic_short_circuit_flag',
		{
			description: 'Place a short-circuit marker component on the active schematic page.',
			inputSchema: addSchematicShortCircuitFlagInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('add_schematic_short_circuit_flag', args)),
	);

	server.registerTool(
		'list_schematic_component_pins',
		{
			description: 'List resolved pins for a schematic component primitive, including coordinates and pin names.',
			inputSchema: schematicComponentPinsInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('list_schematic_component_pins', args)),
	);

	server.registerTool(
		'set_schematic_pin_no_connect',
		{
			description: 'Toggle the no-connect marker state for a schematic component pin.',
			inputSchema: setSchematicPinNoConnectInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('set_schematic_pin_no_connect', args)),
	);

	server.registerTool(
		'connect_schematic_pin_to_net',
		{
			description: 'Attach a net label at a schematic component pin location to connect the pin to a named net. Requires host support for schematic attribute net-label APIs.',
			inputSchema: connectSchematicPinToNetInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('connect_schematic_pin_to_net', args)),
	);

	server.registerTool(
		'connect_schematic_pins_to_nets',
		{
			description: 'Attach net labels for multiple schematic component pins in one request using explicit pin-to-net mappings. Requires host support for schematic attribute net-label APIs.',
			inputSchema: connectSchematicPinsToNetsInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('connect_schematic_pins_to_nets', args)),
	);

	server.registerTool(
		'connect_schematic_pins_with_prefix',
		{
			description: 'Attach net labels for multiple schematic component pins using a shared prefix and each pin number to derive net names. Requires host support for schematic attribute net-label APIs.',
			inputSchema: connectSchematicPinsWithPrefixInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('connect_schematic_pins_with_prefix', args)),
	);

	server.registerTool(
		'add_schematic_text',
		{
			description: 'Add a text primitive to the active schematic page.',
			inputSchema: addSchematicTextInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('add_schematic_text', args)),
	);

	server.registerTool(
		'add_schematic_net_label',
		{
			description: 'Add a net label primitive to the active schematic page. Requires host support for schematic attribute net-label APIs.',
			inputSchema: addSchematicNetLabelInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('add_schematic_net_label', args)),
	);

	server.registerTool(
		'add_schematic_wire',
		{
			description: 'Add a wire primitive to the active schematic page.',
			inputSchema: addSchematicWireInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('add_schematic_wire', args)),
	);

	server.registerTool(
		'list_schematic_primitive_ids',
		{
			description: 'List schematic primitive IDs for the active schematic page by supported family.',
			inputSchema: listSchematicPrimitiveIdsInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('list_schematic_primitive_ids', args)),
	);

	server.registerTool(
		'get_schematic_primitive',
		{
			description: 'Return the full schematic primitive payload for a primitive ID in the active schematic page.',
			inputSchema: primitiveByIdInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('get_schematic_primitive', args)),
	);

	server.registerTool(
		'get_schematic_primitives_bbox',
		{
			description: 'Compute a combined bounding box for schematic primitive IDs in the active schematic page.',
			inputSchema: primitivesBBoxInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('get_schematic_primitives_bbox', args)),
	);

	server.registerTool(
		'add_pcb_component',
		{
			description: 'Place a library device as a component on the active PCB document.',
			inputSchema: addPcbComponentInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('add_pcb_component', args)),
	);

	server.registerTool(
		'modify_pcb_component',
		{
			description: 'Modify a component primitive in the active PCB document.',
			inputSchema: modifyPcbComponentInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('modify_pcb_component', args)),
	);

	server.registerTool(
		'delete_pcb_component',
		{
			description: 'Delete a component primitive from the active PCB document. Set skipConfirmation to true to suppress the bridge-side delete prompt.',
			inputSchema: deletePrimitiveInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('delete_pcb_component', args)),
	);

	server.registerTool(
		'list_pcb_component_pads',
		{
			description: 'List resolved pads for a PCB component primitive, including coordinates, pad numbers, and current nets.',
			inputSchema: pcbComponentPadsInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('list_pcb_component_pads', args)),
	);

	server.registerTool(
		'route_pcb_line_between_component_pads',
		{
			description: 'Create a PCB line segment directly between two component pads, deriving the net from the pads when possible.',
			inputSchema: routePcbLineBetweenComponentPadsInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('route_pcb_line_between_component_pads', args)),
	);

	server.registerTool(
		'route_pcb_lines_between_component_pads',
		{
			description: 'Create multiple PCB line segments between two component pads using caller-supplied waypoints.',
			inputSchema: routePcbLinesBetweenComponentPadsInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('route_pcb_lines_between_component_pads', args)),
	);

	server.registerTool(
		'add_pcb_line',
		{
			description: 'Add a line primitive to the active PCB document.',
			inputSchema: addPcbLineInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('add_pcb_line', args)),
	);

	server.registerTool(
		'add_pcb_text',
		{
			description: 'Add a text primitive to the active PCB document.',
			inputSchema: addPcbTextInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('add_pcb_text', args)),
	);

	server.registerTool(
		'list_pcb_primitive_ids',
		{
			description: 'List PCB primitive IDs for the active PCB document by supported family.',
			inputSchema: listPcbPrimitiveIdsInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('list_pcb_primitive_ids', args)),
	);

	server.registerTool(
		'get_pcb_primitive',
		{
			description: 'Return the full PCB primitive payload for a primitive ID in the active PCB document.',
			inputSchema: primitiveByIdInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('get_pcb_primitive', args)),
	);

	server.registerTool(
		'get_pcb_primitives_bbox',
		{
			description: 'Compute a combined bounding box for PCB primitive IDs in the active PCB document.',
			inputSchema: primitivesBBoxInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('get_pcb_primitives_bbox', args)),
	);

	server.registerTool(
		'list_pcb_nets',
		{
			description: 'List detailed net information for the active PCB document.',
		},
		async () => makeToolResult(await bridgeSession.call('list_pcb_nets')),
	);

	server.registerTool(
		'get_pcb_net',
		{
			description: 'Return details, current color, and routed length for a PCB net.',
			inputSchema: getPcbNetInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('get_pcb_net', args)),
	);

	server.registerTool(
		'set_pcb_net_color',
		{
			description: 'Set the display color for a PCB net in the active PCB document.',
			inputSchema: setPcbNetColorInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('set_pcb_net_color', args)),
	);

	server.registerTool(
		'get_pcb_net_primitives',
		{
			description: 'List primitives associated with a PCB net, optionally filtered by PCB primitive type IDs.',
			inputSchema: getPcbNetPrimitivesInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('get_pcb_net_primitives', args)),
	);

	server.registerTool(
		'modify_schematic_text',
		{
			description: 'Modify a text primitive in the active schematic page.',
			inputSchema: modifySchematicTextInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('modify_schematic_text', args)),
	);

	server.registerTool(
		'delete_schematic_text',
		{
			description: 'Delete a text primitive from the active schematic page. Set skipConfirmation to true to suppress the bridge-side delete prompt.',
			inputSchema: deletePrimitiveInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('delete_schematic_text', args)),
	);

	server.registerTool(
		'modify_schematic_net_label',
		{
			description: 'Modify a net label primitive in the active schematic page. Requires host support for schematic attribute net-label APIs.',
			inputSchema: modifySchematicNetLabelInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('modify_schematic_net_label', args)),
	);

	server.registerTool(
		'modify_schematic_wire',
		{
			description: 'Modify a wire primitive in the active schematic page.',
			inputSchema: modifySchematicWireInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('modify_schematic_wire', args)),
	);

	server.registerTool(
		'delete_schematic_wire',
		{
			description: 'Delete a wire primitive from the active schematic page. Set skipConfirmation to true to suppress the bridge-side delete prompt.',
			inputSchema: deletePrimitiveInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('delete_schematic_wire', args)),
	);

	server.registerTool(
		'modify_pcb_line',
		{
			description: 'Modify a line primitive in the active PCB document.',
			inputSchema: modifyPcbLineInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('modify_pcb_line', args)),
	);

	server.registerTool(
		'delete_pcb_line',
		{
			description: 'Delete a line primitive from the active PCB document. Set skipConfirmation to true to suppress the bridge-side delete prompt.',
			inputSchema: deletePrimitiveInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('delete_pcb_line', args)),
	);

	server.registerTool(
		'modify_pcb_text',
		{
			description: 'Modify a text primitive in the active PCB document.',
			inputSchema: modifyPcbTextInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('modify_pcb_text', args)),
	);

	server.registerTool(
		'delete_pcb_text',
		{
			description: 'Delete a text primitive from the active PCB document. Set skipConfirmation to true to suppress the bridge-side delete prompt.',
			inputSchema: deletePrimitiveInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('delete_pcb_text', args)),
	);

	server.registerTool(
		'rename_board',
		{
			description: 'Rename a board by name.',
			inputSchema: renameBoardInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('rename_board', args)),
	);

	server.registerTool(
		'rename_pcb',
		{
			description: 'Rename a PCB by UUID.',
			inputSchema: renamePcbInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('rename_pcb', args)),
	);

	server.registerTool(
		'rename_schematic',
		{
			description: 'Rename a schematic by UUID.',
			inputSchema: renameSchematicInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('rename_schematic', args)),
	);

	server.registerTool(
		'rename_schematic_page',
		{
			description: 'Rename a schematic page by UUID.',
			inputSchema: renameSchematicPageInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('rename_schematic_page', args)),
	);

	server.registerTool(
		'rename_panel',
		{
			description: 'Rename a panel by UUID.',
			inputSchema: renamePanelInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('rename_panel', args)),
	);

	server.registerTool(
		'delete_board',
		{
			description: 'Delete a board by name. Set skipConfirmation to true to suppress the bridge-side delete prompt.',
			inputSchema: deleteBoardInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('delete_board', args)),
	);

	server.registerTool(
		'delete_pcb',
		{
			description: 'Delete a PCB by UUID. Set skipConfirmation to true to suppress the bridge-side delete prompt.',
			inputSchema: deletePcbInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('delete_pcb', args)),
	);

	server.registerTool(
		'delete_schematic',
		{
			description: 'Delete a schematic by UUID. Set skipConfirmation to true to suppress the bridge-side delete prompt.',
			inputSchema: deleteSchematicInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('delete_schematic', args)),
	);

	server.registerTool(
		'delete_schematic_page',
		{
			description: 'Delete a schematic page by UUID. Set skipConfirmation to true to suppress the bridge-side delete prompt.',
			inputSchema: deleteSchematicPageInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('delete_schematic_page', args)),
	);

	server.registerTool(
		'delete_panel',
		{
			description: 'Delete a panel by UUID. Set skipConfirmation to true to suppress the bridge-side delete prompt.',
			inputSchema: deletePanelInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('delete_panel', args)),
	);

	server.registerTool(
		'get_document_source',
		{
			description: 'Read the source of the active EasyEDA document and return its revision hash.',
		},
		async () => makeToolResult(await bridgeSession.call('get_document_source')),
	);

	server.registerTool(
		'set_document_source',
		{
			description: 'Replace the source of the active EasyEDA document. Provide expectedSourceHash to guard against stale writes, or set force to bypass the check. Set skipConfirmation to true to suppress the bridge-side overwrite prompt.',
			inputSchema: setDocumentSourceInputSchema,
		},
		async args => makeToolResult(await bridgeSession.call('set_document_source', args)),
	);

	server.registerTool(
		'compute_source_revision',
		{
			description: 'Compute the optimistic concurrency revision hash for a source string.',
			inputSchema: computeSourceRevisionInputSchema,
		},
		async ({ source }) => makeToolResult({
			characters: typeof source === 'string' ? source.length : 0,
			sourceHash: computeSourceRevision(typeof source === 'string' ? source : ''),
		}),
	);
}

export function makeToolResult(value: unknown) {
	return {
		content: [
			{
				type: 'text' as const,
				text: JSON.stringify(value, null, 2),
			},
		],
		structuredContent: normalizeStructuredContent(value),
	};
}

export function normalizeStructuredContent(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object' && !Array.isArray(value))
		return value as Record<string, unknown>;

	return { value };
}

function createUsageGuide(): Record<string, unknown> {
	return {
		overview: 'EasyEDA MCP exposes a bridge-aware CAD workflow. Start by verifying connectivity and context before attempting edits.',
		recommendedStartupSequence: [
			'bridge_status',
			'get_current_context',
			'list_project_objects',
		],
		commonWorkflows: {
			inspectProject: [
				'bridge_status',
				'get_current_context',
				'list_project_objects',
			],
			placeComponent: [
				'search_library_devices',
				'get_current_context',
				'add_schematic_component or add_pcb_component',
			],
			editPrimitives: [
				'list_schematic_primitive_ids or list_pcb_primitive_ids',
				'get_schematic_primitive or get_pcb_primitive',
				'modify_* or delete_* tools',
			],
			sourceEditing: [
				'get_document_source',
				'compute_source_revision if needed',
				'set_document_source with expectedSourceHash',
			],
		},
		identifierGuide: {
			documentUuid: 'UUID of a board, PCB, schematic, schematic page, or panel document.',
			primitiveId: 'Identifier of a placed schematic or PCB primitive inside the active document.',
			componentPrimitiveId: 'Primitive ID for a placed component used by pin and pad inspection tools.',
			libraryUuid: 'Library container identifier returned by search_library_devices.',
			deviceUuid: 'Library device identifier returned by search_library_devices and used for placement.',
		},
		limitations: [
			'No true obstacle-aware autorouter/pathfinding API is exposed through the EasyEDA extension SDK.',
			'Schematic net labels can be modified but not deleted because attribute deletion is not exposed by the host SDK.',
		],
	};
}

function enrichBridgeStatus(value: Record<string, unknown>): Record<string, unknown> {
	const connected = value.connected === true;
	const helloPayload = asRecord(value.helloPayload);
	const methods = Array.isArray(helloPayload?.methods) ? helloPayload.methods : [];
	const recommendedNextSteps = connected
		? [
				'Call get_current_context to inspect the active EasyEDA project or document.',
				'Call list_project_objects before rename, delete, copy, or document-open operations.',
				'Call get_usage_guide for workflow and identifier guidance if the host needs more context.',
			]
		: [
				'Ensure EasyEDA is running and the extension has external interaction permission enabled.',
				'Use the EasyEDA extension menu Reconnect action, then call bridge_status again.',
				'If the bridge still does not connect, verify the local MCP server is listening on the configured localhost ports.',
			];

	return {
		...value,
		availableBridgeMethodCount: methods.length,
		recommendedNextSteps,
	};
}

function enrichCurrentContext(value: unknown): Record<string, unknown> {
	const context = normalizeStructuredContent(value);
	const currentProject = asRecord(context.currentProject);
	const currentDocument = asRecord(context.currentDocument);
	const hasProjectContext = Boolean(currentProject);
	const hasDocumentContext = Boolean(currentDocument);
	let contextLevel = 'none';
	if (hasProjectContext && hasDocumentContext)
		contextLevel = 'project-and-document';
	else if (hasProjectContext)
		contextLevel = 'project-only';
	else if (hasDocumentContext)
		contextLevel = 'document-only';

	let recommendedNextSteps: string[];
	if (hasDocumentContext) {
		recommendedNextSteps = [
			'Use document-specific tools that match the active document type.',
			'If you need project inventory or cross-document operations, call list_project_objects next.',
			'For edits, prefer query tools first so primitive IDs and coordinates are verified before modification.',
		];
	}
	else if (hasProjectContext) {
		recommendedNextSteps = [
			'Call list_project_objects to inspect boards, schematics, PCBs, and panels in the active project.',
			'Open a target document before using primitive-level edit tools.',
		];
	}
	else {
		recommendedNextSteps = [
			'Open a project or document in EasyEDA, then call get_current_context again.',
			'If the host needs a workflow primer, call get_usage_guide.',
		];
	}

	return {
		...context,
		contextLevel,
		hasProjectContext,
		hasDocumentContext,
		recommendedNextSteps,
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return undefined;

	return value as Record<string, unknown>;
}
