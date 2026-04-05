import { strict as assert } from 'node:assert';
import test from 'node:test';

import { computeSourceRevision } from '../src/mcp-bridge-protocol';
import {
	addPcbLineInputSchema,
	deleteBoardInputSchema,
	deletePrimitiveInputSchema,
	easyedaToolNames,
	modifyPcbLineInputSchema,
	registerEasyedaTools,
	searchLibraryDevicesInputSchema,
	setDocumentSourceInputSchema,
} from '../src/mcp-tools';

interface RegisteredTool {
	name: string;
	handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function createRegisteredTools(caller?: import('../src/mcp-tools').EasyedaBridgeCaller): RegisteredTool[] {
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
		caller ?? {
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
	assert.ok(registeredTools.some(tool => tool.name === 'import_schematic_to_pcb'));
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

test('get_current_context surfaces start-page bootstrap diagnostics when EasyEDA is stuck on tab_page1', async () => {
	const registeredTools = createRegisteredTools({
		async call(method) {
			if (method === 'get_current_context') {
				return {
					currentDocument: {
						documentType: -1,
						uuid: 'tab_page1',
					},
					editorBootstrapState: {
						startPageOnly: true,
						urlHash: '#id=project-1,tab=*pcb-1@project-1',
						requestedProjectUuid: 'project-1',
						requestedTabIds: ['*pcb-1@project-1'],
						suspectedBootstrapFailure: true,
						warning: 'EasyEDA is still showing only Start Page even though the URL targets a project or document. Project bootstrap likely failed in this session.',
					},
				};
			}

			return { method };
		},
		getConnectionState() {
			return { connected: true };
		},
	});
	const currentContextTool = registeredTools.find(tool => tool.name === 'get_current_context');

	assert.ok(currentContextTool);

	const result = await currentContextTool.handler({}) as { structuredContent: Record<string, unknown> };
	const recommendedNextSteps = result.structuredContent.recommendedNextSteps as string[];

	assert.equal(result.structuredContent.contextLevel, 'document-only');
	assert.equal((result.structuredContent.editorBootstrapState as { suspectedBootstrapFailure: boolean }).suspectedBootstrapFailure, true);
	assert.equal(recommendedNextSteps[0], 'EasyEDA is still on Start Page while the URL targets a project or document. Project bootstrap likely failed in this session.');
	assert.match(recommendedNextSteps[2], /Get an illegal project!|Project does not exist/);
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

test('pcb line schemas allow omitted or empty net values for board outline workflows', () => {
	assert.doesNotThrow(() => {
		addPcbLineInputSchema.parse({
			layer: 'BoardOutLine',
			startX: 0,
			startY: 0,
			endX: 100,
			endY: 0,
		});
	});

	assert.doesNotThrow(() => {
		addPcbLineInputSchema.parse({
			net: '',
			layer: 'BoardOutLine',
			startX: 0,
			startY: 0,
			endX: 100,
			endY: 0,
		});
	});

	assert.doesNotThrow(() => {
		modifyPcbLineInputSchema.parse({
			primitiveId: 'e3',
			net: '',
		});
	});

	assert.doesNotThrow(() => {
		modifyPcbLineInputSchema.parse({
			primitiveId: 'e3',
			net: 'GND',
		});
	});
});

test('set_document_source recovers when EasyEDA applies the source before the bridge response times out', async () => {
	const source = 'updated-source';
	const sourceHash = computeSourceRevision(source);
	const registeredTools = createRegisteredTools({
		async call(method, params) {
			if (method === 'set_document_source')
				throw new Error('EasyEDA bridge timed out waiting for set_document_source');

			if (method === 'get_document_source') {
				return {
					source,
					sourceHash,
					characters: source.length,
				};
			}

			return { method, params };
		},
		getConnectionState() {
			return { connected: true };
		},
	});
	const setDocumentSourceTool = registeredTools.find(tool => tool.name === 'set_document_source');

	assert.ok(setDocumentSourceTool);
	const result = await setDocumentSourceTool.handler({
		source,
		expectedSourceHash: 'old-hash',
		skipConfirmation: true,
	}) as { structuredContent: Record<string, unknown> };

	assert.equal(result.structuredContent.updated, true);
	assert.equal(result.structuredContent.sourceHash, sourceHash);
	assert.equal(result.structuredContent.readbackVerified, true);
	assert.equal(result.structuredContent.timeoutRecovered, true);
	assert.equal(result.structuredContent.previousSourceHash, 'old-hash');
});

test('set_document_source verifies readback even when the bridge reports updated false', async () => {
	const source = 'updated-source';
	const sourceHash = computeSourceRevision(source);
	const registeredTools = createRegisteredTools({
		async call(method, params) {
			if (method === 'set_document_source') {
				return {
					updated: false,
					characters: source.length,
					sourceHash: 'stale-host-hash',
					previousSourceHash: 'old-hash',
				};
			}

			if (method === 'get_document_source') {
				return {
					source,
					sourceHash,
					characters: source.length,
				};
			}

			return { method, params };
		},
		getConnectionState() {
			return { connected: true };
		},
	});
	const setDocumentSourceTool = registeredTools.find(tool => tool.name === 'set_document_source');

	assert.ok(setDocumentSourceTool);
	const result = await setDocumentSourceTool.handler({
		source,
		expectedSourceHash: 'old-hash',
		skipConfirmation: true,
	}) as { structuredContent: Record<string, unknown> };

	assert.equal(result.structuredContent.updated, true);
	assert.equal(result.structuredContent.sourceHash, sourceHash);
	assert.equal(result.structuredContent.readbackVerified, true);
	assert.equal(result.structuredContent.hostReportedUpdated, false);
	assert.equal(result.structuredContent.previousSourceHash, 'old-hash');
});

test('set_document_source rejects host false success when readback does not match the requested source', async () => {
	const source = 'updated-source';
	const registeredTools = createRegisteredTools({
		async call(method, params) {
			if (method === 'set_document_source') {
				return {
					updated: true,
					characters: source.length,
					sourceHash: computeSourceRevision(source),
					previousSourceHash: 'old-hash',
				};
			}

			if (method === 'get_document_source') {
				return {
					source: 'old-source',
					sourceHash: computeSourceRevision('old-source'),
					characters: 'old-source'.length,
				};
			}

			return { method, params };
		},
		getConnectionState() {
			return { connected: true };
		},
	});
	const setDocumentSourceTool = registeredTools.find(tool => tool.name === 'set_document_source');

	assert.ok(setDocumentSourceTool);
	await assert.rejects(
		() => setDocumentSourceTool.handler({
			source,
			expectedSourceHash: 'old-hash',
			skipConfirmation: true,
		}),
		/set_document_source reported success but active document still has/,
	);
});

test('delete_pcb_component recovers when the primitive disappears before the timeout response returns', async () => {
	const registeredTools = createRegisteredTools({
		async call(method, params) {
			if (method === 'delete_pcb_component')
				throw new Error('EasyEDA bridge timed out waiting for delete_pcb_component');

			if (method === 'list_pcb_primitive_ids') {
				return {
					family: 'component',
					primitiveIds: ['e17', 'e18', 'e19'],
				};
			}

			return { method, params };
		},
		getConnectionState() {
			return { connected: true };
		},
	});
	const deleteTool = registeredTools.find(tool => tool.name === 'delete_pcb_component');

	assert.ok(deleteTool);
	const result = await deleteTool.handler({
		primitiveId: 'e0',
		skipConfirmation: true,
	}) as { structuredContent: Record<string, unknown> };

	assert.equal(result.structuredContent.deleted, true);
	assert.equal(result.structuredContent.timeoutRecovered, true);
	assert.equal(result.structuredContent.readbackVerified, true);
	assert.equal(result.structuredContent.postDeleteComponentPresent, false);
	assert.equal(result.structuredContent.sourceRewriteRecovered, undefined);
});

test('delete_pcb_component falls back to source cleanup when timeout leaves the primitive in source', async () => {
	const originalSource = [
		'["DOCTYPE","PCB","1.8"]',
		'["COMPONENT","e1",0,"TopLayer",0,0,0,{},0]',
		'["ATTR","e1e0",0,"e1",4,null,null,"Device","old",0,0,"default",45,6,0,0,3,180,0,0,0,0]',
		'["PAD_NET","e1","1","","e7"]',
		'["COMPONENT","e17",0,1,10,10,0,{},0]',
		'["ATTR","e17e0",0,"e17",3,null,null,"Device","keep",0,0,"default",45,6,0,0,3,0,0,0,0,0]',
	].join('\n');
	const originalSourceHash = computeSourceRevision(originalSource);
	let updatedSource = originalSource;
	const callLog: Array<{ method: string; params?: Record<string, unknown> }> = [];
	const registeredTools = createRegisteredTools({
		async call(method, params) {
			callLog.push({ method, params });

			if (method === 'delete_pcb_component')
				throw new Error('EasyEDA bridge timed out waiting for delete_pcb_component');

			if (method === 'list_pcb_primitive_ids') {
				return {
					family: 'component',
					primitiveIds: updatedSource.includes('["COMPONENT","e1"') ? ['e1', 'e17'] : ['e17'],
				};
			}

			if (method === 'get_document_source') {
				return {
					source: updatedSource,
					sourceHash: computeSourceRevision(updatedSource),
					characters: updatedSource.length,
				};
			}

			if (method === 'set_document_source') {
				updatedSource = String(params?.source ?? '');
				return {
					updated: true,
					characters: updatedSource.length,
					sourceHash: computeSourceRevision(updatedSource),
					previousSourceHash: originalSourceHash,
				};
			}

			if (method === 'save_active_document')
				return { saved: true };

			return { method, params };
		},
		getConnectionState() {
			return { connected: true };
		},
	});
	const deleteTool = registeredTools.find(tool => tool.name === 'delete_pcb_component');

	assert.ok(deleteTool);
	const result = await deleteTool.handler({
		primitiveId: 'e1',
		saveAfter: true,
		skipConfirmation: true,
	}) as { structuredContent: Record<string, unknown> };

	assert.equal(result.structuredContent.deleted, true);
	assert.equal(result.structuredContent.timeoutRecovered, true);
	assert.equal(result.structuredContent.sourceRewriteRecovered, true);
	assert.equal(result.structuredContent.saved, true);
	assert.equal(updatedSource.includes('["COMPONENT","e1"'), false);
	assert.equal(updatedSource.includes('["ATTR","e1e0"'), false);
	assert.equal(updatedSource.includes('["PAD_NET","e1"'), false);
	assert.equal(updatedSource.includes('["COMPONENT","e17"'), true);
	assert.equal(updatedSource.includes('["ATTR","e17e0"'), true);

	const setDocumentSourceCall = callLog.find(entry => entry.method === 'set_document_source');
	assert.ok(setDocumentSourceCall);
	assert.equal(setDocumentSourceCall?.params?.expectedSourceHash, originalSourceHash);
});

test('delete_pcb_component falls back to source cleanup when the bridge reports success but the primitive remains present', async () => {
	const originalSource = [
		'["DOCTYPE","PCB","1.8"]',
		'["COMPONENT","e1",0,"TopLayer",0,0,0,{},0]',
		'["ATTR","e1e0",0,"e1",4,null,null,"Device","old",0,0,"default",45,6,0,0,3,180,0,0,0,0]',
		'["PAD_NET","e1","1","","e7"]',
		'["COMPONENT","e17",0,1,10,10,0,{},0]',
		'["ATTR","e17e0",0,"e17",3,null,null,"Device","keep",0,0,"default",45,6,0,0,3,0,0,0,0,0]',
	].join('\n');
	const originalSourceHash = computeSourceRevision(originalSource);
	let updatedSource = originalSource;
	const registeredTools = createRegisteredTools({
		async call(method, params) {
			if (method === 'delete_pcb_component')
				return { primitiveId: 'e1', deleted: true, saved: false };

			if (method === 'list_pcb_primitive_ids') {
				return {
					family: 'component',
					primitiveIds: updatedSource.includes('["COMPONENT","e1"') ? ['e1', 'e17'] : ['e17'],
				};
			}

			if (method === 'get_document_source') {
				return {
					source: updatedSource,
					sourceHash: computeSourceRevision(updatedSource),
					characters: updatedSource.length,
				};
			}

			if (method === 'set_document_source') {
				updatedSource = String(params?.source ?? '');
				return {
					updated: true,
					characters: updatedSource.length,
					sourceHash: computeSourceRevision(updatedSource),
					previousSourceHash: originalSourceHash,
				};
			}

			return { method, params };
		},
		getConnectionState() {
			return { connected: true };
		},
	});
	const deleteTool = registeredTools.find(tool => tool.name === 'delete_pcb_component');

	assert.ok(deleteTool);
	const result = await deleteTool.handler({
		primitiveId: 'e1',
		skipConfirmation: true,
	}) as { structuredContent: Record<string, unknown> };

	assert.equal(result.structuredContent.deleted, true);
	assert.equal(result.structuredContent.readbackVerified, true);
	assert.equal(result.structuredContent.hostReportedDeleted, true);
	assert.equal(result.structuredContent.sourceRewriteRecovered, true);
	assert.equal(updatedSource.includes('["COMPONENT","e1"'), false);
	assert.equal(updatedSource.includes('["COMPONENT","e17"'), true);
});

test('delete_pcb_component rejects host false success when verified cleanup still leaves the primitive present', async () => {
	const originalSource = [
		'["DOCTYPE","PCB","1.8"]',
		'["COMPONENT","e1",0,"TopLayer",0,0,0,{},0]',
		'["ATTR","e1e0",0,"e1",4,null,null,"Device","old",0,0,"default",45,6,0,0,3,180,0,0,0,0]',
		'["PAD_NET","e1","1","","e7"]',
	].join('\n');
	const registeredTools = createRegisteredTools({
		async call(method, params) {
			if (method === 'delete_pcb_component')
				return { primitiveId: 'e1', deleted: true, saved: false };

			if (method === 'list_pcb_primitive_ids') {
				return {
					family: 'component',
					primitiveIds: ['e1'],
				};
			}

			if (method === 'get_document_source') {
				return {
					source: originalSource,
					sourceHash: computeSourceRevision(originalSource),
					characters: originalSource.length,
				};
			}

			if (method === 'set_document_source') {
				return {
					updated: true,
					characters: originalSource.length,
					sourceHash: computeSourceRevision('different-source'),
					previousSourceHash: computeSourceRevision(originalSource),
				};
			}

			return { method, params };
		},
		getConnectionState() {
			return { connected: true };
		},
	});
	const deleteTool = registeredTools.find(tool => tool.name === 'delete_pcb_component');

	assert.ok(deleteTool);
	await assert.rejects(
		() => deleteTool.handler({
			primitiveId: 'e1',
			skipConfirmation: true,
		}),
		/set_document_source reported success but active document still has/,
	);
});

test('delete_pcb_component treats delayed native deletion as success when source-rewrite fallback fails', async () => {
	const originalSource = [
		'["DOCTYPE","PCB","1.8"]',
		'["COMPONENT","e1",0,"TopLayer",0,0,0,{},0]',
		'["ATTR","e1e0",0,"e1",4,null,null,"Device","old",0,0,"default",45,6,0,0,3,180,0,0,0,0]',
		'["PAD_NET","e1","1","","e7"]',
	].join('\n');
	let listCallCount = 0;
	const registeredTools = createRegisteredTools({
		async call(method, params) {
			if (method === 'delete_pcb_component')
				throw new Error('EasyEDA bridge timed out waiting for delete_pcb_component');

			if (method === 'list_pcb_primitive_ids') {
				listCallCount += 1;
				return {
					family: 'component',
					primitiveIds: listCallCount < 2 ? ['e1'] : [],
				};
			}

			if (method === 'get_document_source') {
				return {
					source: originalSource,
					sourceHash: computeSourceRevision(originalSource),
					characters: originalSource.length,
				};
			}

			if (method === 'set_document_source') {
				return {
					updated: true,
					characters: originalSource.length,
					sourceHash: computeSourceRevision('different-source'),
					previousSourceHash: computeSourceRevision(originalSource),
				};
			}

			return { method, params };
		},
		getConnectionState() {
			return { connected: true };
		},
	});
	const deleteTool = registeredTools.find(tool => tool.name === 'delete_pcb_component');

	assert.ok(deleteTool);
	const result = await deleteTool.handler({
		primitiveId: 'e1',
		skipConfirmation: true,
	}) as { structuredContent: Record<string, unknown> };

	assert.equal(result.structuredContent.deleted, true);
	assert.equal(result.structuredContent.timeoutRecovered, true);
	assert.equal(result.structuredContent.delayedReadbackRecovered, true);
	assert.equal(result.structuredContent.postDeleteComponentPresent, false);
	assert.match(String(result.structuredContent.recoveryError), /set_document_source reported success but active document still has/);
});

test('list_project_objects normalizes schematic and page names from title block metadata', async () => {
	const registeredTools = createRegisteredTools({
		async call(method, params) {
			if (method === 'list_project_objects') {
				return {
					boards: [
						{
							name: 'Board1',
							schematic: {
								name: 'schematic1',
								page: [
									{
										name: 'p1',
										titleBlockData: {
											'@Schematic Name': { value: 'Schematic1' },
											'@Page Name': { value: 'P1' },
										},
									},
								],
							},
						},
					],
					schematics: [
						{
							name: 'schematic1',
							page: [
								{
									name: 'p1',
									titleBlockData: {
										'@Schematic Name': { value: 'Schematic1' },
										'@Page Name': { value: 'P1' },
									},
								},
							],
						},
					],
					schematicPages: [
						{
							name: 'p1',
							titleBlockData: {
								'@Schematic Name': { value: 'Schematic1' },
								'@Page Name': { value: 'P1' },
							},
						},
					],
					pcbs: [],
					panels: [],
				};
			}

			return { method, params };
		},
		getConnectionState() {
			return { connected: true };
		},
	});

	const listProjectObjectsTool = registeredTools.find(tool => tool.name === 'list_project_objects');
	assert.ok(listProjectObjectsTool);

	const result = await listProjectObjectsTool.handler({}) as { structuredContent: Record<string, unknown> };
	const boards = result.structuredContent.boards as Array<Record<string, unknown>>;
	const schematics = result.structuredContent.schematics as Array<Record<string, unknown>>;
	const schematicPages = result.structuredContent.schematicPages as Array<Record<string, unknown>>;

	assert.equal((boards[0].schematic as { name: string }).name, 'Schematic1');
	assert.equal(((boards[0].schematic as { page: Array<{ name: string }> }).page[0]).name, 'P1');
	assert.equal(schematics[0].name, 'Schematic1');
	assert.equal((schematics[0].page as Array<{ name: string }>)[0].name, 'P1');
	assert.equal(schematicPages[0].name, 'P1');
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
	const importSchematicToPcbTool = registeredTools.find(tool => tool.name === 'import_schematic_to_pcb');
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
	assert.ok(importSchematicToPcbTool);
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
	const importSchematicToPcbResult = await importSchematicToPcbTool.handler({ pcbUuid: 'pcb-1' }) as { structuredContent: { method: string } };
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
	assert.equal(importSchematicToPcbResult.structuredContent.method, 'import_schematic_to_pcb');
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
