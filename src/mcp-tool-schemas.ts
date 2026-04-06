import { z } from 'zod';

const scalarRecordSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
const unknownRecordSchema = z.record(z.string(), z.unknown());

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

export const importSchematicToPcbInputSchema = z.object({
	pcbUuid: z.string().min(1),
	saveAfter: z.boolean().optional(),
	allowEmptyResult: z.boolean().optional(),
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
	net: z.string().optional(),
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
	net: z.string().optional(),
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
	'compute_source_revision',
] as const;
