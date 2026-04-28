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
	refreshEasyedaMcpBridgeStatus,
	reconnectEasyedaMcpBridge,
	showBridgeStatus,
	showBridgeStatusWithRefresh,
	startEasyedaMcpBridge,
} from './easyeda-mcp-bridge';
import { EXTENSION_DISPLAY_NAME, EXTENSION_VERSION } from './extension-metadata';

function scheduleRuntimeTimeout(callback: () => void, delayMs: number): void {
	if (eda?.sys_Timer && typeof eda.sys_Timer.setTimeoutTimer === 'function') {
		eda.sys_Timer.setTimeoutTimer(callback, delayMs);
		return;
	}

	const runtimeWindow = globalThis.document?.defaultView;
	if (runtimeWindow && typeof runtimeWindow.setTimeout === 'function') {
		runtimeWindow.setTimeout.call(runtimeWindow, callback, delayMs);
		return;
	}

	globalThis.setTimeout(callback, delayMs);
}

export function activate(status?: 'onStartupFinished', arg?: string): void {
	void status;
	void arg;
	void startEasyedaMcpBridge();
}

export function bridgeStatus(): void {
	showBridgeStatus();
	void refreshEasyedaMcpBridgeStatus().catch(() => {
		// The status dialog should remain available even when background refresh fails.
	});
}

export function bridgeReconnect(): void {
	void reconnectEasyedaMcpBridge();
	scheduleRuntimeTimeout(() => {
		try {
			showBridgeStatus();
			void refreshEasyedaMcpBridgeStatus().catch(() => {
				// The reconnect dialog should still appear if the follow-up refresh fails.
			});
		}
		catch {
			// A hot-loaded runtime can reconnect successfully even when the status dialog path is unavailable.
		}
	}, 1500);
}

export function bridgeAbout(): void {
	const state = getEasyedaMcpBridgeState();
	eda.sys_Dialog.showInformationMessage(
		[
			`${EXTENSION_DISPLAY_NAME} extension`,
			`Version: ${EXTENSION_VERSION}`,
			`Endpoint: ${state.endpoint}`,
			'Use npm run mcp:server to start the MCP server on your machine.',
		].join('\n'),
		EXTENSION_DISPLAY_NAME,
	);
}
