/**
 * 入口文件
 *
 * 本文件为默认扩展入口文件，如果你想要配置其它文件作为入口文件，
 * 请修改 `extension.json` 中的 `entry` 字段；
 *
 * 请在此处使用 `export`  导出所有你希望在 `headerMenus` 中引用的方法，
 * 方法通过方法名与 `headerMenus` 关联。
 *
 * 如需了解更多开发细节，请阅读：
 * https://prodocs.lceda.cn/cn/api/guide/
 */
import {
	getEasyedaMcpBridgeState,
	reconnectEasyedaMcpBridge,
	showBridgeStatus,
	startEasyedaMcpBridge,
} from './easyeda-mcp-bridge';

export function activate(status?: 'onStartupFinished', arg?: string): void {
	void status;
	void arg;
	void startEasyedaMcpBridge();
}

export function bridgeStatus(): void {
	showBridgeStatus();
}

export function bridgeReconnect(): void {
	void reconnectEasyedaMcpBridge();
	setTimeout(() => {
		showBridgeStatus();
	}, 1500);
}

export function bridgeAbout(): void {
	const state = getEasyedaMcpBridgeState();
	eda.sys_Dialog.showInformationMessage(
		[
			'EasyEDA MCP Bridge extension',
			`Endpoint: ${state.endpoint}`,
			'Use npm run mcp:server to start the MCP server on your machine.',
		].join('\n'),
		'EasyEDA MCP Bridge',
	);
}
