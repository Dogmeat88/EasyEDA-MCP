import type { EasyedaBridgeCaller, ToolRegistrar } from './mcp-tool-types';
import { computeSourceRevision } from './mcp-bridge-protocol';
import * as schemas from './mcp-tool-schemas';
import { findAddedPrimitiveIds } from './primitive-id-diff';

export function registerEasyedaTools(server: ToolRegistrar, bridgeSession: EasyedaBridgeCaller): void {
	for (const registration of createToolRegistrations(bridgeSession))
		server.registerTool(registration.name, registration.config, registration.handler);
}

interface ToolRegistration {
	name: string;
	config: Record<string, unknown>;
	handler: (args: Record<string, unknown>) => Promise<ReturnType<typeof makeToolResult>>;
}

function createToolRegistrations(bridgeSession: EasyedaBridgeCaller): ToolRegistration[] {
	return [
		{
			name: 'bridge_status',
			config: { description: 'Inspect the current EasyEDA bridge connection state.' },
			handler: async () => makeToolResult(enrichBridgeStatus(bridgeSession.getConnectionState())),
		},
		{
			name: 'get_usage_guide',
			config: { description: 'Return a compact operational guide for choosing EasyEDA MCP tools, understanding common identifiers, and sequencing typical workflows.' },
			handler: async () => makeToolResult(createUsageGuide()),
		},
		{
			name: 'ping_bridge',
			config: { description: 'Round-trip a lightweight bridge health check through the EasyEDA extension.' },
			handler: async () => makeToolResult(await bridgeSession.call('ping_bridge')),
		},
		{
			name: 'echo_bridge',
			config: { description: 'Round-trip a message through the EasyEDA bridge to verify request and response flow.', inputSchema: schemas.echoBridgeInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('echo_bridge', args)),
		},
		{
			name: 'search_library_devices',
			config: { description: 'Search EasyEDA library devices by keyword or LCSC part numbers.', inputSchema: schemas.searchLibraryDevicesInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('search_library_devices', args)),
		},
		{
			name: 'get_capabilities',
			config: { description: 'Return the EasyEDA bridge capabilities reported by the extension.' },
			handler: async () => makeToolResult(await bridgeSession.call('get_capabilities')),
		},
		{
			name: 'get_current_context',
			config: { description: 'Return the active EasyEDA document and project context.' },
			handler: async () => makeToolResult(enrichCurrentContext(await bridgeSession.call('get_current_context'))),
		},
		{
			name: 'list_project_objects',
			config: { description: 'List boards, PCBs, schematics, schematic pages, and panels in the current project.' },
			handler: async () => makeToolResult(normalizeProjectObjects(await bridgeSession.call('list_project_objects'))),
		},
		{
			name: 'open_document',
			config: { description: 'Open a document in EasyEDA by UUID.', inputSchema: schemas.openDocumentInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('open_document', args)),
		},
		{
			name: 'save_active_document',
			config: { description: 'Save the currently focused schematic page, PCB, or panel document.' },
			handler: async () => makeToolResult(await bridgeSession.call('save_active_document')),
		},
		{
			name: 'create_board',
			config: { description: 'Create a board in the active EasyEDA project, optionally linking an existing schematic and PCB.', inputSchema: schemas.createBoardInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('create_board', args)),
		},
		{
			name: 'create_pcb',
			config: { description: 'Create a PCB in the active EasyEDA project.', inputSchema: schemas.createDocumentInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('create_pcb', args)),
		},
		{
			name: 'import_schematic_to_pcb',
			config: { description: 'Import linked schematic changes into a target PCB and fail if EasyEDA reports success without mutating an empty PCB.', inputSchema: schemas.importSchematicToPcbInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('import_schematic_to_pcb', args)),
		},
		{
			name: 'create_panel',
			config: { description: 'Create a panel in the active EasyEDA project.' },
			handler: async () => makeToolResult(await bridgeSession.call('create_panel')),
		},
		{
			name: 'create_schematic',
			config: { description: 'Create a schematic in the active EasyEDA project.', inputSchema: schemas.createDocumentInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('create_schematic', args)),
		},
		{
			name: 'create_schematic_page',
			config: { description: 'Create a schematic page under an existing schematic.', inputSchema: schemas.createSchematicPageInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('create_schematic_page', args)),
		},
		{
			name: 'copy_board',
			config: { description: 'Copy an existing board by board name.', inputSchema: schemas.copyBoardInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('copy_board', args)),
		},
		{
			name: 'copy_pcb',
			config: { description: 'Copy an existing PCB, optionally attaching the copy to a board.', inputSchema: schemas.copyPcbInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('copy_pcb', args)),
		},
		{
			name: 'copy_panel',
			config: { description: 'Copy an existing panel by UUID.', inputSchema: schemas.copyPanelInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('copy_panel', args)),
		},
		{
			name: 'copy_schematic',
			config: { description: 'Copy an existing schematic, optionally attaching the copy to a board.', inputSchema: schemas.copySchematicInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('copy_schematic', args)),
		},
		{
			name: 'copy_schematic_page',
			config: { description: 'Copy an existing schematic page, optionally into a target schematic.', inputSchema: schemas.copySchematicPageInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('copy_schematic_page', args)),
		},
		{
			name: 'add_schematic_component',
			config: { description: 'Place a library device as a component on the active schematic page.', inputSchema: schemas.addSchematicComponentInputSchema },
			handler: async args => makeToolResult(await callAddSchematicComponentWithRecovery(bridgeSession, args)),
		},
		{
			name: 'modify_schematic_component',
			config: { description: 'Modify a component primitive on the active schematic page.', inputSchema: schemas.modifySchematicComponentInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('modify_schematic_component', args)),
		},
		{
			name: 'delete_schematic_component',
			config: { description: 'Delete a component primitive from the active schematic page. Set skipConfirmation to true to suppress the bridge-side delete prompt.', inputSchema: schemas.deletePrimitiveInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('delete_schematic_component', args)),
		},
		{
			name: 'add_schematic_net_flag',
			config: { description: 'Place a power or ground net flag on the active schematic page.', inputSchema: schemas.addSchematicNetFlagInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('add_schematic_net_flag', args)),
		},
		{
			name: 'add_schematic_net_port',
			config: { description: 'Place a net port component on the active schematic page.', inputSchema: schemas.addSchematicNetPortInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('add_schematic_net_port', args)),
		},
		{
			name: 'add_schematic_short_circuit_flag',
			config: { description: 'Place a short-circuit marker component on the active schematic page.', inputSchema: schemas.addSchematicShortCircuitFlagInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('add_schematic_short_circuit_flag', args)),
		},
		{
			name: 'list_schematic_component_pins',
			config: { description: 'List resolved pins for a schematic component primitive, including coordinates and pin names.', inputSchema: schemas.schematicComponentPinsInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('list_schematic_component_pins', args)),
		},
		{
			name: 'set_schematic_pin_no_connect',
			config: { description: 'Toggle the no-connect marker state for a schematic component pin.', inputSchema: schemas.setSchematicPinNoConnectInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('set_schematic_pin_no_connect', args)),
		},
		{
			name: 'connect_schematic_pin_to_net',
			config: { description: 'Attach a named net to a schematic component pin. Prefers a net label when supported by the host and falls back to a short net-assigned wire stub when net-label APIs are unavailable.', inputSchema: schemas.connectSchematicPinToNetInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('connect_schematic_pin_to_net', args)),
		},
		{
			name: 'connect_schematic_pins_to_nets',
			config: { description: 'Attach named nets for multiple schematic component pins in one request using explicit pin-to-net mappings. Prefers net labels and falls back to short net-assigned wire stubs when net-label APIs are unavailable.', inputSchema: schemas.connectSchematicPinsToNetsInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('connect_schematic_pins_to_nets', args)),
		},
		{
			name: 'connect_schematic_pins_with_prefix',
			config: { description: 'Attach named nets for multiple schematic component pins using a shared prefix and each pin number to derive net names. Prefers net labels and falls back to short net-assigned wire stubs when net-label APIs are unavailable.', inputSchema: schemas.connectSchematicPinsWithPrefixInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('connect_schematic_pins_with_prefix', args)),
		},
		{
			name: 'add_schematic_text',
			config: { description: 'Add a text primitive to the active schematic page.', inputSchema: schemas.addSchematicTextInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('add_schematic_text', args)),
		},
		{
			name: 'add_schematic_net_label',
			config: { description: 'Add a net label primitive to the active schematic page. Requires host support for schematic attribute net-label APIs.', inputSchema: schemas.addSchematicNetLabelInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('add_schematic_net_label', args)),
		},
		{
			name: 'add_schematic_wire',
			config: { description: 'Add a wire primitive to the active schematic page.', inputSchema: schemas.addSchematicWireInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('add_schematic_wire', args)),
		},
		{
			name: 'list_schematic_primitive_ids',
			config: { description: 'List schematic primitive IDs for the active schematic page by supported family.', inputSchema: schemas.listSchematicPrimitiveIdsInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('list_schematic_primitive_ids', args)),
		},
		{
			name: 'get_schematic_primitive',
			config: { description: 'Return the full schematic primitive payload for a primitive ID in the active schematic page.', inputSchema: schemas.primitiveByIdInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('get_schematic_primitive', args)),
		},
		{
			name: 'get_schematic_primitives_bbox',
			config: { description: 'Compute a combined bounding box for schematic primitive IDs in the active schematic page.', inputSchema: schemas.primitivesBBoxInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('get_schematic_primitives_bbox', args)),
		},
		{
			name: 'add_pcb_component',
			config: { description: 'Place a library device as a component on the active PCB document. If the host creates the component and then throws, the bridge attempts to recover the placed primitive from live PCB state.', inputSchema: schemas.addPcbComponentInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('add_pcb_component', args)),
		},
		{
			name: 'modify_pcb_component',
			config: { description: 'Modify a component primitive in the active PCB document.', inputSchema: schemas.modifyPcbComponentInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('modify_pcb_component', args)),
		},
		{
			name: 'delete_pcb_component',
			config: { description: 'Delete a component primitive from the active PCB document. Set skipConfirmation to true to suppress the bridge-side delete prompt.', inputSchema: schemas.deletePrimitiveInputSchema },
			handler: async args => makeToolResult(await callDeletePcbComponentWithRecovery(bridgeSession, args)),
		},
		{
			name: 'list_pcb_component_pads',
			config: { description: 'List resolved pads for a PCB component primitive, including coordinates, pad numbers, and current nets.', inputSchema: schemas.pcbComponentPadsInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('list_pcb_component_pads', args)),
		},
		{
			name: 'route_pcb_line_between_component_pads',
			config: { description: 'Create a PCB line segment directly between two component pads, deriving the net from the pads when possible.', inputSchema: schemas.routePcbLineBetweenComponentPadsInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('route_pcb_line_between_component_pads', args)),
		},
		{
			name: 'route_pcb_lines_between_component_pads',
			config: { description: 'Create multiple PCB line segments between two component pads using caller-supplied waypoints.', inputSchema: schemas.routePcbLinesBetweenComponentPadsInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('route_pcb_lines_between_component_pads', args)),
		},
		{
			name: 'add_pcb_line',
			config: { description: 'Add a line primitive to the active PCB document.', inputSchema: schemas.addPcbLineInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('add_pcb_line', args)),
		},
		{
			name: 'add_pcb_text',
			config: { description: 'Add a text primitive to the active PCB document.', inputSchema: schemas.addPcbTextInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('add_pcb_text', args)),
		},
		{
			name: 'list_pcb_primitive_ids',
			config: { description: 'List PCB primitive IDs for the active PCB document by supported family.', inputSchema: schemas.listPcbPrimitiveIdsInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('list_pcb_primitive_ids', args)),
		},
		{
			name: 'get_pcb_primitive',
			config: { description: 'Return the full PCB primitive payload for a primitive ID in the active PCB document.', inputSchema: schemas.primitiveByIdInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('get_pcb_primitive', args)),
		},
		{
			name: 'get_pcb_primitives_bbox',
			config: { description: 'Compute a combined bounding box for PCB primitive IDs in the active PCB document.', inputSchema: schemas.primitivesBBoxInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('get_pcb_primitives_bbox', args)),
		},
		{
			name: 'list_pcb_nets',
			config: { description: 'List detailed net information for the active PCB document.' },
			handler: async () => makeToolResult(await bridgeSession.call('list_pcb_nets')),
		},
		{
			name: 'run_pcb_drc',
			config: { description: 'Run EasyEDA PCB DRC on the active PCB document and return the categorized result summary.', inputSchema: schemas.runPcbDrcInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('run_pcb_drc', args)),
		},
		{
			name: 'get_pcb_net',
			config: { description: 'Return details, current color, and routed length for a PCB net.', inputSchema: schemas.getPcbNetInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('get_pcb_net', args)),
		},
		{
			name: 'set_pcb_net_color',
			config: { description: 'Set the display color for a PCB net in the active PCB document.', inputSchema: schemas.setPcbNetColorInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('set_pcb_net_color', args)),
		},
		{
			name: 'get_pcb_net_primitives',
			config: { description: 'List primitives associated with a PCB net, optionally filtered by PCB primitive type IDs.', inputSchema: schemas.getPcbNetPrimitivesInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('get_pcb_net_primitives', args)),
		},
		{
			name: 'modify_schematic_text',
			config: { description: 'Modify a text primitive in the active schematic page.', inputSchema: schemas.modifySchematicTextInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('modify_schematic_text', args)),
		},
		{
			name: 'delete_schematic_text',
			config: { description: 'Delete a text primitive from the active schematic page. Set skipConfirmation to true to suppress the bridge-side delete prompt.', inputSchema: schemas.deletePrimitiveInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('delete_schematic_text', args)),
		},
		{
			name: 'modify_schematic_net_label',
			config: { description: 'Modify a net label primitive in the active schematic page. Requires host support for schematic attribute net-label APIs.', inputSchema: schemas.modifySchematicNetLabelInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('modify_schematic_net_label', args)),
		},
		{
			name: 'modify_schematic_wire',
			config: { description: 'Modify a wire primitive in the active schematic page.', inputSchema: schemas.modifySchematicWireInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('modify_schematic_wire', args)),
		},
		{
			name: 'delete_schematic_wire',
			config: { description: 'Delete a wire primitive from the active schematic page. Set skipConfirmation to true to suppress the bridge-side delete prompt.', inputSchema: schemas.deletePrimitiveInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('delete_schematic_wire', args)),
		},
		{
			name: 'modify_pcb_line',
			config: { description: 'Modify a line primitive in the active PCB document.', inputSchema: schemas.modifyPcbLineInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('modify_pcb_line', args)),
		},
		{
			name: 'delete_pcb_line',
			config: { description: 'Delete a line primitive from the active PCB document. Set skipConfirmation to true to suppress the bridge-side delete prompt.', inputSchema: schemas.deletePrimitiveInputSchema },
			handler: async args => makeToolResult(await callDeletePcbLineWithRecovery(bridgeSession, args)),
		},
		{
			name: 'modify_pcb_text',
			config: { description: 'Modify a text primitive in the active PCB document.', inputSchema: schemas.modifyPcbTextInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('modify_pcb_text', args)),
		},
		{
			name: 'delete_pcb_text',
			config: { description: 'Delete a text primitive from the active PCB document. Set skipConfirmation to true to suppress the bridge-side delete prompt.', inputSchema: schemas.deletePrimitiveInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('delete_pcb_text', args)),
		},
		{
			name: 'rename_board',
			config: { description: 'Rename a board by name.', inputSchema: schemas.renameBoardInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('rename_board', args)),
		},
		{
			name: 'rename_pcb',
			config: { description: 'Rename a PCB by UUID.', inputSchema: schemas.renamePcbInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('rename_pcb', args)),
		},
		{
			name: 'rename_schematic',
			config: { description: 'Rename a schematic by UUID.', inputSchema: schemas.renameSchematicInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('rename_schematic', args)),
		},
		{
			name: 'rename_schematic_page',
			config: { description: 'Rename a schematic page by UUID.', inputSchema: schemas.renameSchematicPageInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('rename_schematic_page', args)),
		},
		{
			name: 'rename_panel',
			config: { description: 'Rename a panel by UUID.', inputSchema: schemas.renamePanelInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('rename_panel', args)),
		},
		{
			name: 'delete_board',
			config: { description: 'Delete a board by name. Set skipConfirmation to true to suppress the bridge-side delete prompt.', inputSchema: schemas.deleteBoardInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('delete_board', args)),
		},
		{
			name: 'delete_pcb',
			config: { description: 'Delete a PCB by UUID. Set skipConfirmation to true to suppress the bridge-side delete prompt.', inputSchema: schemas.deletePcbInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('delete_pcb', args)),
		},
		{
			name: 'delete_schematic',
			config: { description: 'Delete a schematic by UUID. Set skipConfirmation to true to suppress the bridge-side delete prompt.', inputSchema: schemas.deleteSchematicInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('delete_schematic', args)),
		},
		{
			name: 'delete_schematic_page',
			config: { description: 'Delete a schematic page by UUID. Set skipConfirmation to true to suppress the bridge-side delete prompt.', inputSchema: schemas.deleteSchematicPageInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('delete_schematic_page', args)),
		},
		{
			name: 'delete_panel',
			config: { description: 'Delete a panel by UUID. Set skipConfirmation to true to suppress the bridge-side delete prompt.', inputSchema: schemas.deletePanelInputSchema },
			handler: async args => makeToolResult(await bridgeSession.call('delete_panel', args)),
		},
		{
			name: 'get_document_source',
			config: { description: 'Read the source of the active EasyEDA document and return its revision hash.' },
			handler: async () => makeToolResult(await bridgeSession.call('get_document_source')),
		},
		{
			name: 'set_document_source',
			config: { description: 'Replace the source of the active EasyEDA document. Provide expectedSourceHash to guard against stale writes, or set force to bypass the check. Set skipConfirmation to true to suppress the bridge-side overwrite prompt.', inputSchema: schemas.setDocumentSourceInputSchema },
			handler: async args => makeToolResult(await callSetDocumentSourceWithRecovery(bridgeSession, args)),
		},
		{
			name: 'compute_source_revision',
			config: { description: 'Compute the optimistic concurrency revision hash for a source string.', inputSchema: schemas.computeSourceRevisionInputSchema },
			handler: async ({ source }) => makeToolResult({
				characters: typeof source === 'string' ? source.length : 0,
				sourceHash: computeSourceRevision(typeof source === 'string' ? source : ''),
			}),
		},
	];
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

function normalizeProjectObjects(value: unknown): Record<string, unknown> {
	const projectObjects = normalizeStructuredContent(value);
	return {
		...projectObjects,
		boards: normalizeBoards(projectObjects.boards),
		schematics: normalizeSchematics(projectObjects.schematics),
		schematicPages: normalizeSchematicPages(projectObjects.schematicPages),
	};
}

function parseSourceLine(line: string): unknown[] | undefined {
	if (!line.startsWith('['))
		return undefined;

	try {
		const parsed = JSON.parse(line);
		return Array.isArray(parsed) ? parsed : undefined;
	}
	catch {
		return undefined;
	}
}

function removePcbComponentFromSource(source: string, primitiveId: string): string | undefined {
	const lines = source.split('\n');
	let removed = false;
	const filtered = lines.filter((line) => {
		const parsed = parseSourceLine(line);
		if (!parsed)
			return true;

		const tag = parsed[0];
		if (tag === 'COMPONENT' && parsed[1] === primitiveId) {
			removed = true;
			return false;
		}

		if (tag === 'ATTR' && parsed[3] === primitiveId) {
			removed = true;
			return false;
		}

		if (tag === 'PAD_NET' && parsed[1] === primitiveId) {
			removed = true;
			return false;
		}

		return true;
	});

	if (!removed)
		return undefined;

	return filtered.join('\n');
}

function removePcbLineFromSource(source: string, primitiveId: string): string | undefined {
	const lineTags = new Set(['POLY', 'TRACK', 'LINE']);
	const lines = source.split('\n');
	let removed = false;
	const filtered = lines.filter((line) => {
		const parsed = parseSourceLine(line);
		if (!parsed)
			return true;

		const tag = parsed[0];
		if (typeof tag === 'string' && lineTags.has(tag) && parsed[1] === primitiveId) {
			removed = true;
			return false;
		}

		return true;
	});

	if (!removed)
		return undefined;

	return filtered.join('\n');
}

function hasPcbLineInSource(source: string, primitiveId: string): boolean {
	const lineTags = new Set(['POLY', 'TRACK', 'LINE']);
	for (const line of source.split('\n')) {
		const parsed = parseSourceLine(line);
		if (!parsed)
			continue;

		const tag = parsed[0];
		if (typeof tag === 'string' && lineTags.has(tag) && parsed[1] === primitiveId)
			return true;
	}

	return false;
}

async function getDocumentSourceSnapshot(bridgeSession: EasyedaBridgeCaller): Promise<{
	source: string;
	sourceHash: string;
	characters: number;
}> {
	const currentDocumentSource = asRecord(await bridgeSession.call('get_document_source'));
	const source = typeof currentDocumentSource?.source === 'string'
		? currentDocumentSource.source
		: undefined;
	const sourceHash = typeof currentDocumentSource?.sourceHash === 'string'
		? currentDocumentSource.sourceHash
		: undefined;
	if (typeof source !== 'string' || typeof sourceHash !== 'string')
		throw new Error('EasyEDA bridge returned an invalid document source snapshot');

	return {
		source,
		sourceHash,
		characters: typeof currentDocumentSource?.characters === 'number' ? currentDocumentSource.characters : source.length,
	};
}

async function listSchematicComponentPrimitiveIds(bridgeSession: EasyedaBridgeCaller): Promise<string[] | undefined> {
	const response = asRecord(await bridgeSession.call('list_schematic_primitive_ids', { family: 'component' }));
	const primitiveIds = response?.primitiveIds;
	if (!Array.isArray(primitiveIds))
		return undefined;

	return primitiveIds.filter((value): value is string => typeof value === 'string');
}

async function recoverCreatedSchematicComponentFromReadback(
	bridgeSession: EasyedaBridgeCaller,
	previousPrimitiveIds: string[] | undefined,
	previousSourceSnapshot?: {
		sourceHash: string;
	},
): Promise<Record<string, unknown> | null> {
	if (!previousPrimitiveIds)
		return null;

	try {
		const nextPrimitiveIds = await listSchematicComponentPrimitiveIds(bridgeSession);
		if (!nextPrimitiveIds)
			return null;

		const addedPrimitiveIds = findAddedPrimitiveIds(previousPrimitiveIds, nextPrimitiveIds);
		if (addedPrimitiveIds.length !== 1)
			return null;

		const primitiveId = addedPrimitiveIds[0];
		const primitiveResponse = asRecord(await bridgeSession.call('get_schematic_primitive', { primitiveId }));
		if (!primitiveResponse || !('primitive' in primitiveResponse))
			return null;

		const primitive = primitiveResponse.primitive;
		if (previousSourceSnapshot) {
			const currentDocumentSource = await getDocumentSourceSnapshot(bridgeSession);
			if (!currentDocumentSource.source.includes(`"${primitiveId}"`))
				return null;

			return {
				primitiveId,
				primitive,
				saved: true,
				readbackVerified: true,
				sourceHash: currentDocumentSource.sourceHash,
				previousSourceHash: previousSourceSnapshot.sourceHash,
				characters: currentDocumentSource.characters,
			};
		}

		return {
			primitiveId,
			primitive,
			readbackVerified: true,
		};
	}
	catch {
		return null;
	}
}

async function callAddSchematicComponentWithRecovery(
	bridgeSession: EasyedaBridgeCaller,
	args: Record<string, unknown>,
): Promise<unknown> {
	const previousPrimitiveIds = await listSchematicComponentPrimitiveIds(bridgeSession);
	const previousSourceSnapshot = args.saveAfter === true
		? await getDocumentSourceSnapshot(bridgeSession)
		: undefined;

	try {
		return normalizeStructuredContent(await bridgeSession.call('add_schematic_component', args));
	}
	catch (error: unknown) {
		if (!(error instanceof Error) || !error.message.includes('timed out waiting for add_schematic_component'))
			throw error;

		const recovered = await recoverCreatedSchematicComponentFromReadback(
			bridgeSession,
			previousPrimitiveIds,
			previousSourceSnapshot,
		);
		if (!recovered)
			throw error;

		return {
			...recovered,
			timeoutRecovered: true,
		};
	}
}

async function listPcbComponentPrimitiveIds(bridgeSession: EasyedaBridgeCaller): Promise<string[] | undefined> {
	const response = asRecord(await bridgeSession.call('list_pcb_primitive_ids', { family: 'component' }));
	const primitiveIds = response?.primitiveIds;
	if (!Array.isArray(primitiveIds))
		return undefined;

	return primitiveIds.filter((value): value is string => typeof value === 'string');
}

async function listPcbLinePrimitiveIds(bridgeSession: EasyedaBridgeCaller): Promise<string[] | undefined> {
	const response = asRecord(await bridgeSession.call('list_pcb_primitive_ids', { family: 'line' }));
	const primitiveIds = response?.primitiveIds;
	if (!Array.isArray(primitiveIds))
		return undefined;

	return primitiveIds.filter((value): value is string => typeof value === 'string');
}

async function rewritePcbComponentDeletionFromSource(
	bridgeSession: EasyedaBridgeCaller,
	args: Record<string, unknown>,
	primitiveId: string,
	metadata: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
	const currentDocumentSource = await getDocumentSourceSnapshot(bridgeSession);
	const cleanedSource = removePcbComponentFromSource(currentDocumentSource.source, primitiveId);
	if (typeof cleanedSource !== 'string')
		throw new TypeError(`delete_pcb_component could not remove primitive ${primitiveId} from the active document source`);

	const rewriteResult = normalizeStructuredContent(await callSetDocumentSourceWithRecovery(bridgeSession, {
		source: cleanedSource,
		expectedSourceHash: currentDocumentSource.sourceHash,
		skipConfirmation: true,
	}));

	const updatedComponentPrimitiveIds = await listPcbComponentPrimitiveIds(bridgeSession);
	if (updatedComponentPrimitiveIds?.includes(primitiveId))
		throw new Error(`delete_pcb_component reported success but primitive ${primitiveId} still exists after verified source rewrite`);

	let saved: unknown;
	if (args.saveAfter === true)
		saved = asRecord(await bridgeSession.call('save_active_document'))?.saved;

	return {
		primitiveId,
		deleted: true,
		saved,
		...metadata,
		sourceRewriteRecovered: true,
		postDeleteComponentPresent: false,
		sourceHash: rewriteResult.sourceHash,
		previousSourceHash: rewriteResult.previousSourceHash,
	};
}

async function rewritePcbLineDeletionFromSource(
	bridgeSession: EasyedaBridgeCaller,
	args: Record<string, unknown>,
	primitiveId: string,
	metadata: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
	const currentDocumentSource = await getDocumentSourceSnapshot(bridgeSession);
	const cleanedSource = removePcbLineFromSource(currentDocumentSource.source, primitiveId);
	if (typeof cleanedSource !== 'string')
		throw new TypeError(`delete_pcb_line could not remove primitive ${primitiveId} from the active document source`);

	const rewriteResult = normalizeStructuredContent(await callSetDocumentSourceWithRecovery(bridgeSession, {
		source: cleanedSource,
		expectedSourceHash: currentDocumentSource.sourceHash,
		skipConfirmation: true,
	}));

	const updatedLinePrimitiveIds = await listPcbLinePrimitiveIds(bridgeSession);
	if (updatedLinePrimitiveIds?.includes(primitiveId))
		throw new Error(`delete_pcb_line reported success but primitive ${primitiveId} still exists after verified source rewrite`);

	let saved: unknown;
	if (args.saveAfter === true)
		saved = asRecord(await bridgeSession.call('save_active_document'))?.saved;

	return {
		primitiveId,
		deleted: true,
		saved,
		...metadata,
		sourceRewriteRecovered: true,
		postDeleteLinePresent: false,
		sourceHash: rewriteResult.sourceHash,
		previousSourceHash: rewriteResult.previousSourceHash,
	};
}

async function recoverDelayedDeletedPcbComponent(
	bridgeSession: EasyedaBridgeCaller,
	primitiveId: string,
	metadata: Record<string, unknown>,
	recoveryError: unknown,
): Promise<Record<string, unknown> | null> {
	const componentPrimitiveIds = await listPcbComponentPrimitiveIds(bridgeSession);
	if (!componentPrimitiveIds || componentPrimitiveIds.includes(primitiveId))
		return null;

	return {
		...metadata,
		primitiveId,
		deleted: true,
		postDeleteComponentPresent: false,
		delayedReadbackRecovered: true,
		recoveryError: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
	};
}

async function recoverDelayedDeletedPcbLine(
	bridgeSession: EasyedaBridgeCaller,
	primitiveId: string,
	metadata: Record<string, unknown>,
	recoveryError: unknown,
): Promise<Record<string, unknown> | null> {
	const linePrimitiveIds = await listPcbLinePrimitiveIds(bridgeSession);
	if (!linePrimitiveIds || linePrimitiveIds.includes(primitiveId))
		return null;

	return {
		...metadata,
		primitiveId,
		deleted: true,
		postDeleteLinePresent: false,
		delayedReadbackRecovered: true,
		recoveryError: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
	};
}

async function callDeletePcbComponentWithRecovery(
	bridgeSession: EasyedaBridgeCaller,
	args: Record<string, unknown>,
): Promise<unknown> {
	const primitiveId = typeof args.primitiveId === 'string' ? args.primitiveId : undefined;

	try {
		const bridgeResult = normalizeStructuredContent(await bridgeSession.call('delete_pcb_component', args));
		if (typeof primitiveId !== 'string')
			return bridgeResult;

		const componentPrimitiveIds = await listPcbComponentPrimitiveIds(bridgeSession);
		if (componentPrimitiveIds && !componentPrimitiveIds.includes(primitiveId)) {
			return {
				...bridgeResult,
				primitiveId,
				deleted: true,
				postDeleteComponentPresent: false,
				readbackVerified: true,
				hostReportedDeleted: bridgeResult.deleted,
			};
		}

		try {
			return await rewritePcbComponentDeletionFromSource(bridgeSession, args, primitiveId, {
				readbackVerified: true,
				hostReportedDeleted: bridgeResult.deleted,
			});
		}
		catch (recoveryError: unknown) {
			const delayedRecovery = await recoverDelayedDeletedPcbComponent(bridgeSession, primitiveId, {
				readbackVerified: true,
				hostReportedDeleted: bridgeResult.deleted,
			}, recoveryError);
			if (delayedRecovery)
				return delayedRecovery;

			throw recoveryError;
		}
	}
	catch (error: unknown) {
		if (!(error instanceof Error) || !error.message.includes('timed out waiting for delete_pcb_component'))
			throw error;

		if (typeof primitiveId !== 'string')
			throw error;

		const componentPrimitiveIds = await listPcbComponentPrimitiveIds(bridgeSession);

		if (componentPrimitiveIds && !componentPrimitiveIds.includes(primitiveId)) {
			return {
				primitiveId,
				deleted: true,
				timeoutRecovered: true,
				readbackVerified: true,
				postDeleteComponentPresent: false,
			};
		}

		try {
			return await rewritePcbComponentDeletionFromSource(bridgeSession, args, primitiveId, {
				timeoutRecovered: true,
				readbackVerified: true,
			});
		}
		catch (recoveryError: unknown) {
			const delayedRecovery = await recoverDelayedDeletedPcbComponent(bridgeSession, primitiveId, {
				timeoutRecovered: true,
				readbackVerified: true,
			}, recoveryError);
			if (delayedRecovery)
				return delayedRecovery;

			throw recoveryError;
		}
	}
}

async function callDeletePcbLineWithRecovery(
	bridgeSession: EasyedaBridgeCaller,
	args: Record<string, unknown>,
): Promise<unknown> {
	const primitiveId = typeof args.primitiveId === 'string' ? args.primitiveId : undefined;

	try {
		const bridgeResult = normalizeStructuredContent(await bridgeSession.call('delete_pcb_line', args));
		if (typeof primitiveId !== 'string')
			return bridgeResult;

		const linePrimitiveIds = await listPcbLinePrimitiveIds(bridgeSession);
		const currentDocumentSource = await getDocumentSourceSnapshot(bridgeSession);
		if (linePrimitiveIds && !linePrimitiveIds.includes(primitiveId) && !hasPcbLineInSource(currentDocumentSource.source, primitiveId)) {
			return {
				...bridgeResult,
				primitiveId,
				deleted: true,
				postDeleteLinePresent: false,
				readbackVerified: true,
				hostReportedDeleted: bridgeResult.deleted,
				sourceHash: currentDocumentSource.sourceHash,
			};
		}

		try {
			return await rewritePcbLineDeletionFromSource(bridgeSession, args, primitiveId, {
				readbackVerified: true,
				hostReportedDeleted: bridgeResult.deleted,
			});
		}
		catch (recoveryError: unknown) {
			const delayedRecovery = await recoverDelayedDeletedPcbLine(bridgeSession, primitiveId, {
				readbackVerified: true,
				hostReportedDeleted: bridgeResult.deleted,
			}, recoveryError);
			if (delayedRecovery)
				return delayedRecovery;

			throw recoveryError;
		}
	}
	catch (error: unknown) {
		if (!(error instanceof Error) || !error.message.includes('timed out waiting for delete_pcb_line'))
			throw error;

		if (typeof primitiveId !== 'string')
			throw error;

		const linePrimitiveIds = await listPcbLinePrimitiveIds(bridgeSession);
		const currentDocumentSource = await getDocumentSourceSnapshot(bridgeSession);

		if (linePrimitiveIds && !linePrimitiveIds.includes(primitiveId) && !hasPcbLineInSource(currentDocumentSource.source, primitiveId)) {
			return {
				primitiveId,
				deleted: true,
				timeoutRecovered: true,
				readbackVerified: true,
				postDeleteLinePresent: false,
				sourceHash: currentDocumentSource.sourceHash,
			};
		}

		try {
			return await rewritePcbLineDeletionFromSource(bridgeSession, args, primitiveId, {
				timeoutRecovered: true,
				readbackVerified: true,
			});
		}
		catch (recoveryError: unknown) {
			const delayedRecovery = await recoverDelayedDeletedPcbLine(bridgeSession, primitiveId, {
				timeoutRecovered: true,
				readbackVerified: true,
			}, recoveryError);
			if (delayedRecovery)
				return delayedRecovery;

			throw recoveryError;
		}
	}
}

async function callSetDocumentSourceWithRecovery(
	bridgeSession: EasyedaBridgeCaller,
	args: Record<string, unknown>,
): Promise<unknown> {
	const desiredSource = typeof args.source === 'string' ? args.source : undefined;
	if (typeof desiredSource !== 'string')
		throw new Error('set_document_source requires a string source');

	const desiredSourceHash = computeSourceRevision(desiredSource);

	try {
		const bridgeResult = normalizeStructuredContent(await bridgeSession.call('set_document_source', args));
		const currentDocumentSource = await getDocumentSourceSnapshot(bridgeSession);
		if (currentDocumentSource.sourceHash !== desiredSourceHash) {
			throw new Error(`set_document_source reported success but active document still has ${currentDocumentSource.sourceHash} instead of ${desiredSourceHash}`);
		}

		return {
			...bridgeResult,
			updated: true,
			characters: currentDocumentSource.characters,
			sourceHash: currentDocumentSource.sourceHash,
			previousSourceHash: typeof bridgeResult.previousSourceHash === 'string'
				? bridgeResult.previousSourceHash
				: typeof args.expectedSourceHash === 'string'
					? args.expectedSourceHash
					: undefined,
			readbackVerified: true,
			hostReportedUpdated: bridgeResult.updated,
		};
	}
	catch (error: unknown) {
		if (!(error instanceof Error) || !error.message.includes('timed out waiting for set_document_source'))
			throw error;

		const currentDocumentSource = await getDocumentSourceSnapshot(bridgeSession);
		if (currentDocumentSource.sourceHash !== desiredSourceHash)
			throw error;

		return {
			updated: true,
			characters: currentDocumentSource.characters,
			sourceHash: desiredSourceHash,
			previousSourceHash: typeof args.expectedSourceHash === 'string' ? args.expectedSourceHash : undefined,
			readbackVerified: true,
			timeoutRecovered: true,
		};
	}
}

function createUsageGuide(): Record<string, unknown> {
	return {
		overview: 'EasyEDA MCP exposes a bridge-aware CAD workflow. Start by verifying connectivity and context before attempting edits.',
		recommendedStartupSequence: ['bridge_status', 'get_current_context', 'list_project_objects'],
		commonWorkflows: {
			inspectProject: ['bridge_status', 'get_current_context', 'list_project_objects'],
			placeComponent: ['search_library_devices', 'get_current_context', 'add_schematic_component or add_pcb_component'],
			editPrimitives: ['list_schematic_primitive_ids or list_pcb_primitive_ids', 'get_schematic_primitive or get_pcb_primitive', 'modify_* or delete_* tools'],
			sourceEditing: ['get_document_source', 'compute_source_revision if needed', 'set_document_source with expectedSourceHash'],
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

function normalizeBoards(value: unknown): unknown {
	if (!Array.isArray(value))
		return value;

	return value.map((entry) => {
		const board = asRecord(entry);
		if (!board)
			return entry;

		return {
			...board,
			schematic: normalizeSchematic(board.schematic),
		};
	});
}

function normalizeSchematics(value: unknown): unknown {
	if (!Array.isArray(value))
		return value;

	return value.map(normalizeSchematic);
}

function normalizeSchematic(value: unknown): unknown {
	const schematic = asRecord(value);
	if (!schematic)
		return value;

	const normalizedPages = normalizeSchematicPages(schematic.page);
	const normalizedSchematicName = getSchematicNameFromPages(normalizedPages);

	return {
		...schematic,
		...(normalizedSchematicName ? { name: normalizedSchematicName } : {}),
		page: normalizedPages,
	};
}

function normalizeSchematicPages(value: unknown): unknown {
	if (!Array.isArray(value))
		return value;

	return value.map((entry) => {
		const page = asRecord(entry);
		if (!page)
			return entry;

		const normalizedPageName = getTitleBlockValue(page.titleBlockData, '@Page Name');
		return {
			...page,
			...(normalizedPageName ? { name: normalizedPageName } : {}),
		};
	});
}

function getSchematicNameFromPages(value: unknown): string | undefined {
	if (!Array.isArray(value))
		return undefined;

	for (const entry of value) {
		const page = asRecord(entry);
		const pageTitleBlockData = page?.titleBlockData;
		const schematicName = getTitleBlockValue(pageTitleBlockData, '@Schematic Name');
		if (schematicName)
			return schematicName;
	}

	return undefined;
}

function getTitleBlockValue(titleBlockData: unknown, key: string): string | undefined {
	const titleBlockRecord = asRecord(titleBlockData);
	const entry = asRecord(titleBlockRecord?.[key]);
	const value = entry?.value;
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function enrichCurrentContext(value: unknown): Record<string, unknown> {
	const context = normalizeStructuredContent(value);
	const currentProject = asRecord(context.currentProject);
	const currentDocument = asRecord(context.currentDocument);
	const editorBootstrapState = asRecord(context.editorBootstrapState);
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
	if (editorBootstrapState?.suspectedBootstrapFailure === true) {
		recommendedNextSteps = [
			'EasyEDA is still on Start Page while the URL targets a project or document. Project bootstrap likely failed in this session.',
			'Reopen the target project through the EasyEDA UI or reload the editor shell, then call get_current_context again.',
			'If open_document still times out, inspect the EasyEDA UI console for errors such as Get an illegal project! or Project does not exist.',
		];
	}
	else if (hasDocumentContext) {
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
