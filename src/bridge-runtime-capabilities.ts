export interface SchematicAttributeApiLike {
	createNetLabel?: unknown;
}

export interface SchematicNetLabelCapabilitySummary {
	attributeApiAvailable: boolean;
	createNetLabelAvailable: boolean;
	supported: boolean;
	unsupportedMethods: string[];
	recommendedFallbackToolsByMethod: Record<string, string[]>;
	warning?: string;
}

export function getSchematicNetLabelCapabilitySummary(attributeApi?: SchematicAttributeApiLike): SchematicNetLabelCapabilitySummary {
	if (!attributeApi) {
		return {
			attributeApiAvailable: false,
			createNetLabelAvailable: false,
			supported: false,
			unsupportedMethods: ['add_schematic_net_label', 'modify_schematic_net_label'],
			recommendedFallbackToolsByMethod: {
				add_schematic_net_label: ['connect_schematic_pin_to_net', 'connect_schematic_pins_to_nets', 'connect_schematic_pins_with_prefix', 'add_schematic_wire'],
				modify_schematic_net_label: ['get_document_source', 'set_document_source'],
			},
			warning: 'This EasyEDA runtime does not expose sch_PrimitiveAttribute. Net-label creation and modification are unavailable on this host build.',
		};
	}

	if (typeof attributeApi.createNetLabel !== 'function') {
		return {
			attributeApiAvailable: true,
			createNetLabelAvailable: false,
			supported: false,
			unsupportedMethods: ['add_schematic_net_label', 'modify_schematic_net_label'],
			recommendedFallbackToolsByMethod: {
				add_schematic_net_label: ['connect_schematic_pin_to_net', 'connect_schematic_pins_to_nets', 'connect_schematic_pins_with_prefix', 'add_schematic_wire'],
				modify_schematic_net_label: ['get_document_source', 'set_document_source'],
			},
			warning: 'This EasyEDA runtime does not expose sch_PrimitiveAttribute.createNetLabel. Net-label creation is unavailable on this host build.',
		};
	}

	return {
		attributeApiAvailable: true,
		createNetLabelAvailable: true,
		supported: true,
		unsupportedMethods: [],
		recommendedFallbackToolsByMethod: {},
	};
}
