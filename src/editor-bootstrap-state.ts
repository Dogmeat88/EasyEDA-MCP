export interface EditorBootstrapStateInput {
	startPageOnly?: boolean;
	urlHash?: string;
	requestedProjectUuid?: string;
	requestedTabIds?: string[];
	suspectedBootstrapFailure?: boolean;
}

export function describeEditorBootstrapState(
	currentDocument: { uuid?: string } | undefined,
	splitScreenTree: { tabs?: Array<{ tabId?: string }> } | undefined,
	urlHash: string,
): Record<string, unknown> {
	const tabs = Array.isArray(splitScreenTree?.tabs) ? splitScreenTree.tabs : [];
	const startPageOnly = tabs.length === 1 && tabs[0]?.tabId === 'tab_page1';
	const requestedProjectUuid = matchEditorHashValue(urlHash, 'id');
	const requestedTabIds = getRequestedTabIds(urlHash);
	const currentDocumentUuid = typeof currentDocument?.uuid === 'string' ? currentDocument.uuid : undefined;
	const suspectedBootstrapFailure = currentDocumentUuid === 'tab_page1'
		&& startPageOnly
		&& (Boolean(requestedProjectUuid) || requestedTabIds.length > 0);

	return {
		startPageOnly,
		urlHash,
		requestedProjectUuid,
		requestedTabIds,
		suspectedBootstrapFailure,
		warning: suspectedBootstrapFailure
			? 'EasyEDA is still showing only Start Page even though the URL targets a project or document. Project bootstrap likely failed in this session.'
			: undefined,
	};
}

export function getOpenDocumentBootstrapFailure(
	context: { currentDocument?: Record<string, unknown>; editorBootstrapState?: EditorBootstrapStateInput },
	documentUuid: string,
): string | undefined {
	const currentDocument = isRecord(context.currentDocument) ? context.currentDocument : undefined;
	const editorBootstrapState = isRecord(context.editorBootstrapState) ? context.editorBootstrapState : undefined;
	if (editorBootstrapState?.suspectedBootstrapFailure !== true)
		return undefined;

	const currentDocumentUuid = typeof currentDocument?.uuid === 'string' ? currentDocument.uuid : 'unknown';
	const requestedProjectUuid = typeof editorBootstrapState.requestedProjectUuid === 'string'
		? editorBootstrapState.requestedProjectUuid
		: undefined;
	const requestedTabIds = Array.isArray(editorBootstrapState.requestedTabIds)
		? editorBootstrapState.requestedTabIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
		: [];
	const requestedTabsLabel = requestedTabIds.length > 0 ? requestedTabIds.join(', ') : 'none';
	const projectLabel = requestedProjectUuid ?? 'unknown';

	return `open_document cannot proceed because EasyEDA is still stuck on Start Page (${currentDocumentUuid}) while the editor URL targets project ${projectLabel} and tabs ${requestedTabsLabel}. Requested document ${documentUuid} is unlikely to open successfully in this bootstrap state. Reload or reopen the target project in the EasyEDA UI, then call get_current_context again before retrying open_document.`;
}

function matchEditorHashValue(hash: string, key: string): string | undefined {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = hash.match(new RegExp(`[#,]${escapedKey}=([^,]+)`));
	return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function getRequestedTabIds(hash: string): string[] {
	const rawTabs = matchEditorHashValue(hash, 'tab');
	if (!rawTabs)
		return [];

	return rawTabs
		.split('|')
		.map(entry => entry.trim())
		.filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}