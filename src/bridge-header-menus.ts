export interface BridgeHeaderMenuItemDefinition {
	id: string;
	title: string;
	registerFn: string;
}

export interface BridgeHeaderMenuDefinition {
	id: string;
	title: string;
	menuItems: BridgeHeaderMenuItemDefinition[];
}

export interface BridgeHeaderMenuApi {
	replaceHeaderMenus?: (menus: BridgeHeaderMenuDefinition[]) => Promise<unknown> | unknown;
	insertHeaderMenus?: (menus: BridgeHeaderMenuDefinition[]) => Promise<unknown> | unknown;
}

export interface BridgeHeaderMenuDocumentLike {
	body?: {
		textContent?: string;
	};
}

const BRIDGE_HEADER_MENUS: BridgeHeaderMenuDefinition[] = [
	{
		id: 'EasyEDA MCP Bridge',
		title: 'EasyEDA MCP Bridge',
		menuItems: [
			{
				id: 'MCP Bridge Reconnect',
				title: 'Reconnect',
				registerFn: 'bridgeReconnect',
			},
			{
				id: 'MCP Bridge Status',
				title: 'Status',
				registerFn: 'bridgeStatus',
			},
		],
	},
];

export function cloneBridgeHeaderMenus(): BridgeHeaderMenuDefinition[] {
	return BRIDGE_HEADER_MENUS.map(menu => ({
		...menu,
		menuItems: menu.menuItems.map(menuItem => ({ ...menuItem })),
	}));
}

export function shouldSyncBridgeHeaderMenus(currentDocument?: BridgeHeaderMenuDocumentLike | null): boolean {
	const bodyText = currentDocument?.body?.textContent;
	if (typeof bodyText === 'string' && bodyText.includes('EasyEDA MCP Bridge'))
		return false;

	return true;
}

export async function syncBridgeHeaderMenus(headerMenuApi: BridgeHeaderMenuApi | null | undefined): Promise<boolean> {
	if (typeof headerMenuApi?.replaceHeaderMenus !== 'function' && typeof headerMenuApi?.insertHeaderMenus !== 'function')
		return false;

	if (!shouldSyncBridgeHeaderMenus(globalThis.document))
		return false;

	const menus = cloneBridgeHeaderMenus();
	if (typeof headerMenuApi.replaceHeaderMenus === 'function') {
		await headerMenuApi.replaceHeaderMenus(menus);
		return true;
	}

	await headerMenuApi.insertHeaderMenus!(menus);
	return true;
}
