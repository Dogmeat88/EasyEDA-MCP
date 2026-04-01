import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
	deleteBoardInputSchema,
	deletePrimitiveInputSchema,
	easyedaToolNames,
	registerEasyedaTools,
	searchLibraryDevicesInputSchema,
	setDocumentSourceInputSchema,
} from '../src/mcp-tools';

interface RegisteredTool {
	name: string;
	handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function createRegisteredTools(): RegisteredTool[] {
	const registeredTools: RegisteredTool[] = [];
	registerEasyedaTools(
		{
			registerTool: ((name: string, _config: unknown, handler: unknown) => {
				registeredTools.push({
					name,
					handler: handler as RegisteredTool['handler'],
				});
			}) as import('../src/mcp-tools').ToolRegistrar['registerTool'],
		},
		{
			async call(method, params) {
				return { method, params };
			},
			getConnectionState() {
				return { connected: true };
			},
		},
	);

	return registeredTools;
}

test('registerEasyedaTools registers the full MCP surface including component, query, and net tools', () => {
	const registeredTools = createRegisteredTools();

	assert.deepEqual(
		registeredTools.map(tool => tool.name),
		[...easyedaToolNames],
	);
	assert.ok(registeredTools.some(tool => tool.name === 'get_usage_guide'));
	assert.ok(registeredTools.some(tool => tool.name === 'search_library_devices'));
	assert.ok(registeredTools.some(tool => tool.name === 'ping_bridge'));
	assert.ok(registeredTools.some(tool => tool.name === 'echo_bridge'));
	assert.ok(registeredTools.some(tool => tool.name === 'create_board'));
	assert.ok(registeredTools.some(tool => tool.name === 'create_panel'));
	assert.ok(registeredTools.some(tool => tool.name === 'create_schematic_page'));
	assert.ok(registeredTools.some(tool => tool.name === 'copy_board'));
	assert.ok(registeredTools.some(tool => tool.name === 'copy_pcb'));
	assert.ok(registeredTools.some(tool => tool.name === 'copy_panel'));
	assert.ok(registeredTools.some(tool => tool.name === 'copy_schematic'));
	assert.ok(registeredTools.some(tool => tool.name === 'copy_schematic_page'));
	assert.ok(registeredTools.some(tool => tool.name === 'add_schematic_component'));
	assert.ok(registeredTools.some(tool => tool.name === 'add_schematic_short_circuit_flag'));
	assert.ok(registeredTools.some(tool => tool.name === 'connect_schematic_pin_to_net'));
	assert.ok(registeredTools.some(tool => tool.name === 'connect_schematic_pins_to_nets'));
	assert.ok(registeredTools.some(tool => tool.name === 'connect_schematic_pins_with_prefix'));
	assert.ok(registeredTools.some(tool => tool.name === 'list_pcb_component_pads'));
	assert.ok(registeredTools.some(tool => tool.name === 'route_pcb_line_between_component_pads'));
	assert.ok(registeredTools.some(tool => tool.name === 'route_pcb_lines_between_component_pads'));
	assert.ok(registeredTools.some(tool => tool.name === 'get_pcb_net'));
	assert.ok(registeredTools.some(tool => tool.name === 'add_schematic_net_label'));
	assert.ok(registeredTools.some(tool => tool.name === 'add_pcb_text'));
	assert.ok(registeredTools.some(tool => tool.name === 'modify_schematic_text'));
	assert.ok(registeredTools.some(tool => tool.name === 'delete_pcb_text'));
});

test('searchLibraryDevicesInputSchema requires a query or lcscIds', () => {
	assert.throws(
		() => searchLibraryDevicesInputSchema.parse({}),
		/Provide query or lcscIds/,
	);

	assert.doesNotThrow(() => {
		searchLibraryDevicesInputSchema.parse({ query: 'STM32' });
	});

	assert.doesNotThrow(() => {
		searchLibraryDevicesInputSchema.parse({ lcscIds: ['C12345'] });
	});
});

test('setDocumentSourceInputSchema requires either expectedSourceHash or force', () => {
	assert.throws(
		() => setDocumentSourceInputSchema.parse({ source: 'updated' }),
		/Provide expectedSourceHash or force: true/,
	);

	assert.doesNotThrow(() => {
		setDocumentSourceInputSchema.parse({
			source: 'updated',
			expectedSourceHash: '7:deadbeef',
		});
	});

	assert.doesNotThrow(() => {
		setDocumentSourceInputSchema.parse({
			source: 'updated',
			force: true,
			skipConfirmation: true,
		});
	});
});

test('delete input schemas accept skipConfirmation', () => {
	assert.doesNotThrow(() => {
		deletePrimitiveInputSchema.parse({
			primitiveId: 'e123',
			skipConfirmation: true,
		});
	});

	assert.doesNotThrow(() => {
		deleteBoardInputSchema.parse({
			boardName: 'Board1',
			skipConfirmation: true,
		});
	});
});

test('new component, pin, pad, query, and net tool handlers dispatch the expected bridge methods', async () => {
	const registeredTools = createRegisteredTools();
	const bridgeStatusTool = registeredTools.find(tool => tool.name === 'bridge_status');
	const usageGuideTool = registeredTools.find(tool => tool.name === 'get_usage_guide');
	const searchDevicesTool = registeredTools.find(tool => tool.name === 'search_library_devices');
	const pingBridgeTool = registeredTools.find(tool => tool.name === 'ping_bridge');
	const echoBridgeTool = registeredTools.find(tool => tool.name === 'echo_bridge');
	const currentContextTool = registeredTools.find(tool => tool.name === 'get_current_context');
	const createBoardTool = registeredTools.find(tool => tool.name === 'create_board');
	const createPanelTool = registeredTools.find(tool => tool.name === 'create_panel');
	const createSchematicPageTool = registeredTools.find(tool => tool.name === 'create_schematic_page');
	const copyBoardTool = registeredTools.find(tool => tool.name === 'copy_board');
	const copyPcbTool = registeredTools.find(tool => tool.name === 'copy_pcb');
	const copyPanelTool = registeredTools.find(tool => tool.name === 'copy_panel');
	const copySchematicTool = registeredTools.find(tool => tool.name === 'copy_schematic');
	const copySchematicPageTool = registeredTools.find(tool => tool.name === 'copy_schematic_page');
	const schematicComponentTool = registeredTools.find(tool => tool.name === 'add_schematic_component');
	const schematicShortCircuitFlagTool = registeredTools.find(tool => tool.name === 'add_schematic_short_circuit_flag');
	const connectSchematicPinTool = registeredTools.find(tool => tool.name === 'connect_schematic_pin_to_net');
	const connectSchematicPinsTool = registeredTools.find(tool => tool.name === 'connect_schematic_pins_to_nets');
	const connectSchematicPrefixTool = registeredTools.find(tool => tool.name === 'connect_schematic_pins_with_prefix');
	const listPcbPadsTool = registeredTools.find(tool => tool.name === 'list_pcb_component_pads');
	const routePcbPadsTool = registeredTools.find(tool => tool.name === 'route_pcb_line_between_component_pads');
	const routePcbSegmentsTool = registeredTools.find(tool => tool.name === 'route_pcb_lines_between_component_pads');
	const pcbNetTool = registeredTools.find(tool => tool.name === 'get_pcb_net');
	const pcbNetColorTool = registeredTools.find(tool => tool.name === 'set_pcb_net_color');
	const pcbNetPrimitivesTool = registeredTools.find(tool => tool.name === 'get_pcb_net_primitives');

	assert.ok(bridgeStatusTool);
	assert.ok(usageGuideTool);
	assert.ok(searchDevicesTool);
	assert.ok(pingBridgeTool);
	assert.ok(echoBridgeTool);
	assert.ok(currentContextTool);
	assert.ok(createBoardTool);
	assert.ok(createPanelTool);
	assert.ok(createSchematicPageTool);
	assert.ok(copyBoardTool);
	assert.ok(copyPcbTool);
	assert.ok(copyPanelTool);
	assert.ok(copySchematicTool);
	assert.ok(copySchematicPageTool);
	assert.ok(schematicComponentTool);
	assert.ok(schematicShortCircuitFlagTool);
	assert.ok(connectSchematicPinTool);
	assert.ok(connectSchematicPinsTool);
	assert.ok(connectSchematicPrefixTool);
	assert.ok(listPcbPadsTool);
	assert.ok(routePcbPadsTool);
	assert.ok(routePcbSegmentsTool);
	assert.ok(pcbNetTool);
	assert.ok(pcbNetColorTool);
	assert.ok(pcbNetPrimitivesTool);

	const bridgeStatusResult = await bridgeStatusTool.handler({}) as { structuredContent: Record<string, unknown> };
	const usageGuideResult = await usageGuideTool.handler({}) as { structuredContent: Record<string, unknown> };
	const searchResult = await searchDevicesTool.handler({ query: 'STM32' }) as { structuredContent: { method: string } };
	const pingBridgeResult = await pingBridgeTool.handler({}) as { structuredContent: { method: string } };
	const echoBridgeResult = await echoBridgeTool.handler({ message: 'hello bridge' }) as { structuredContent: { method: string } };
	const currentContextResult = await currentContextTool.handler({}) as { structuredContent: Record<string, unknown> };
	const createBoardResult = await createBoardTool.handler({ schematicUuid: 'sch-1', pcbUuid: 'pcb-1' }) as { structuredContent: { method: string } };
	const createPanelResult = await createPanelTool.handler({}) as { structuredContent: { method: string } };
	const createSchematicPageResult = await createSchematicPageTool.handler({ schematicUuid: 'sch-1' }) as { structuredContent: { method: string } };
	const copyBoardResult = await copyBoardTool.handler({ sourceBoardName: 'Board 1' }) as { structuredContent: { method: string } };
	const copyPcbResult = await copyPcbTool.handler({ pcbUuid: 'pcb-1' }) as { structuredContent: { method: string } };
	const copyPanelResult = await copyPanelTool.handler({ panelUuid: 'panel-1' }) as { structuredContent: { method: string } };
	const copySchematicResult = await copySchematicTool.handler({ schematicUuid: 'sch-1' }) as { structuredContent: { method: string } };
	const copySchematicPageResult = await copySchematicPageTool.handler({ schematicPageUuid: 'sch-page-1' }) as { structuredContent: { method: string } };
	const schematicComponentResult = await schematicComponentTool.handler({
		libraryUuid: 'lib-1',
		deviceUuid: 'dev-1',
		x: 10,
		y: 20,
	}) as { structuredContent: { method: string } };
	const schematicShortCircuitFlagResult = await schematicShortCircuitFlagTool.handler({ x: 10, y: 20 }) as { structuredContent: { method: string } };
	const connectSchematicPinResult = await connectSchematicPinTool.handler({
		componentPrimitiveId: 'sch-comp-1',
		pinNumber: '1',
		net: 'VCC',
	}) as { structuredContent: { method: string } };
	const connectSchematicPinsResult = await connectSchematicPinsTool.handler({
		componentPrimitiveId: 'sch-comp-1',
		connections: [{ pinNumber: '1', net: 'VCC' }, { pinNumber: '2', net: 'GND' }],
	}) as { structuredContent: { method: string } };
	const connectSchematicPrefixResult = await connectSchematicPrefixTool.handler({
		componentPrimitiveId: 'sch-comp-1',
		pinNumbers: ['1', '2'],
		netPrefix: 'BUS',
	}) as { structuredContent: { method: string } };
	const listPcbPadsResult = await listPcbPadsTool.handler({ componentPrimitiveId: 'pcb-comp-1' }) as { structuredContent: { method: string } };
	const routePcbPadsResult = await routePcbPadsTool.handler({
		fromComponentPrimitiveId: 'pcb-comp-1',
		fromPadNumber: '1',
		toComponentPrimitiveId: 'pcb-comp-2',
		toPadNumber: '2',
		layer: 'TopLayer',
	}) as { structuredContent: { method: string } };
	const routePcbSegmentsResult = await routePcbSegmentsTool.handler({
		fromComponentPrimitiveId: 'pcb-comp-1',
		fromPadNumber: '1',
		toComponentPrimitiveId: 'pcb-comp-2',
		toPadNumber: '2',
		layer: 'TopLayer',
		waypoints: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
	}) as { structuredContent: { method: string } };
	const pcbNetResult = await pcbNetTool.handler({ net: 'GND' }) as { structuredContent: { method: string } };
	const pcbNetColorResult = await pcbNetColorTool.handler({
		net: 'GND',
		color: { r: 255, g: 0, b: 0, alpha: 1 },
	}) as { structuredContent: { method: string } };
	const pcbNetPrimitivesResult = await pcbNetPrimitivesTool.handler({ net: 'GND', primitiveTypes: [1, 2] }) as { structuredContent: { method: string } };

	assert.equal(Array.isArray(bridgeStatusResult.structuredContent.recommendedNextSteps), true);
	assert.equal(Array.isArray(usageGuideResult.structuredContent.recommendedStartupSequence), true);
	assert.equal(currentContextResult.structuredContent.contextLevel, 'none');
	assert.equal(Array.isArray(currentContextResult.structuredContent.recommendedNextSteps), true);
	assert.equal(searchResult.structuredContent.method, 'search_library_devices');
	assert.equal(pingBridgeResult.structuredContent.method, 'ping_bridge');
	assert.equal(echoBridgeResult.structuredContent.method, 'echo_bridge');
	assert.equal(createBoardResult.structuredContent.method, 'create_board');
	assert.equal(createPanelResult.structuredContent.method, 'create_panel');
	assert.equal(createSchematicPageResult.structuredContent.method, 'create_schematic_page');
	assert.equal(copyBoardResult.structuredContent.method, 'copy_board');
	assert.equal(copyPcbResult.structuredContent.method, 'copy_pcb');
	assert.equal(copyPanelResult.structuredContent.method, 'copy_panel');
	assert.equal(copySchematicResult.structuredContent.method, 'copy_schematic');
	assert.equal(copySchematicPageResult.structuredContent.method, 'copy_schematic_page');
	assert.equal(schematicComponentResult.structuredContent.method, 'add_schematic_component');
	assert.equal(schematicShortCircuitFlagResult.structuredContent.method, 'add_schematic_short_circuit_flag');
	assert.equal(connectSchematicPinResult.structuredContent.method, 'connect_schematic_pin_to_net');
	assert.equal(connectSchematicPinsResult.structuredContent.method, 'connect_schematic_pins_to_nets');
	assert.equal(connectSchematicPrefixResult.structuredContent.method, 'connect_schematic_pins_with_prefix');
	assert.equal(listPcbPadsResult.structuredContent.method, 'list_pcb_component_pads');
	assert.equal(routePcbPadsResult.structuredContent.method, 'route_pcb_line_between_component_pads');
	assert.equal(routePcbSegmentsResult.structuredContent.method, 'route_pcb_lines_between_component_pads');
	assert.equal(pcbNetResult.structuredContent.method, 'get_pcb_net');
	assert.equal(pcbNetColorResult.structuredContent.method, 'set_pcb_net_color');
	assert.equal(pcbNetPrimitivesResult.structuredContent.method, 'get_pcb_net_primitives');
});
