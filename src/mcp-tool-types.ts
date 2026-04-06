import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BridgeMethod } from './mcp-bridge-protocol';

export interface EasyedaBridgeCaller {
	call: (method: BridgeMethod, params?: Record<string, unknown>) => Promise<unknown>;
	getConnectionState: () => Record<string, unknown>;
}

export type ToolRegistrar = Pick<McpServer, 'registerTool'>;
