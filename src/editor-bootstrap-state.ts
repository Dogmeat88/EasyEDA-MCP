export interface EditorBootstrapStateInput {
	startPageOnly?: boolean;
	urlHash?: string;
	requestedProjectUuid?: string;
	requestedTabIds?: string[];
	suspectedBootstrapFailure?: boolean;
}

export interface EditorShellIframeDescriptor {
	id?: string;
	src?: string;
	className?: string;
}

const DOCUMENT_TYPE_SCHEMATIC_PAGE = 1;
const DOCUMENT_TYPE_PCB = 3;
const DOCUMENT_TYPE_PANEL = 26;

export function getRuntimeLocationHash(locationLike: { hash?: unknown } | undefined | null): string {
	return typeof locationLike?.hash === 'string' ? locationLike.hash : '';
}

export function inferCurrentDocumentFromEditorShell(
	currentDocument: unknown,
	urlHash: string,
	iframeDescriptors: EditorShellIframeDescriptor[],
): Record<string, unknown> | undefined {
	const currentDocumentUuid = typeof currentDocument?.uuid === 'string' ? currentDocument.uuid : undefined;
	if (currentDocumentUuid && currentDocumentUuid !== 'tab_page1')
		return undefined;

	const activeTab = getActiveRequestedTab(urlHash);
	if (!activeTab)
		return undefined;

	const { documentUuid, projectUuid } = parseRequestedTab(activeTab);
	if (!documentUuid)
		return undefined;

	const matchingIframe = iframeDescriptors.find(iframe => matchesRequestedDocumentIframe(iframe, documentUuid, projectUuid));
	const inferredDocumentType = inferDocumentTypeFromIframeSrc(matchingIframe?.src);
	if (inferredDocumentType === undefined)
		return undefined;

	return {
		...(isRecord(currentDocument) ? currentDocument : {}),
		documentType: inferredDocumentType,
		inferredFromEditorShell: true,
		projectUuid,
		sourceFrameId: matchingIframe?.id,
		uuid: documentUuid,
	};
}

export function describeEditorBootstrapState(
	currentDocument: { uuid?: string } | undefined,
	splitScreenTree: { tabs?: Array<{ tabId?: string }> } | undefined,
	urlHash: string,
): Record<string, unknown> {
	const tabs = Array.isArray(splitScreenTree?.tabs) ? splitScreenTree.tabs : [];
	const visibleTabIds = tabs
		.map(tab => typeof tab?.tabId === 'string' ? tab.tabId : undefined)
		.filter((tabId): tabId is string => Boolean(tabId));
	const startPageOnly = tabs.length === 1 && tabs[0]?.tabId === 'tab_page1';
	const requestedProjectUuid = matchEditorHashValue(urlHash, 'id');
	const requestedTabIds = getRequestedTabIds(urlHash);
	const activeRequestedTab = getActiveRequestedTab(urlHash);
	const currentDocumentUuid = typeof currentDocument?.uuid === 'string' ? currentDocument.uuid : undefined;
	const startPageDocument = currentDocumentUuid === 'tab_page1' || currentDocumentUuid === '0' || !currentDocumentUuid;
	const requestedActiveTabMissing = Boolean(activeRequestedTab)
		&& !visibleTabIds.some(tabId => matchesRequestedTabId(tabId, activeRequestedTab!));
	const suspectedBootstrapFailure = (startPageDocument
		&& startPageOnly
		&& (Boolean(requestedProjectUuid) || requestedTabIds.length > 0))
		|| requestedActiveTabMissing;
	const warning = startPageDocument && startPageOnly
		? 'EasyEDA is still showing only Start Page even though the URL targets a project or document. Project bootstrap likely failed in this session.'
		: requestedActiveTabMissing
			? `EasyEDA URL targets tab ${normalizeRequestedTabId(activeRequestedTab!)}, but the split-screen tree never hydrated that tab. Editor bootstrap likely failed or the host document state is stale in this session.`
			: undefined;

	return {
		startPageOnly,
		urlHash,
		requestedProjectUuid,
		requestedTabIds,
		activeRequestedTab: activeRequestedTab ? normalizeRequestedTabId(activeRequestedTab) : undefined,
		requestedActiveTabMissing,
		visibleTabIds,
		suspectedBootstrapFailure,
		warning,
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
	const requestedActiveTab = typeof editorBootstrapState.activeRequestedTab === 'string'
		? editorBootstrapState.activeRequestedTab
		: undefined;
	const requestedActiveTabMissing = editorBootstrapState.requestedActiveTabMissing === true;
	const visibleTabIds = Array.isArray(editorBootstrapState.visibleTabIds)
		? editorBootstrapState.visibleTabIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
		: [];
	const requestedTabsLabel = requestedTabIds.length > 0 ? requestedTabIds.join(', ') : 'none';
	const projectLabel = requestedProjectUuid ?? 'unknown';
	const visibleTabsLabel = visibleTabIds.length > 0 ? visibleTabIds.join(', ') : 'none';

	if (requestedActiveTabMissing) {
		const requestedTabLabel = requestedActiveTab ?? requestedTabsLabel;
		return `open_document cannot proceed because EasyEDA has not hydrated the requested tab ${requestedTabLabel} into the editor shell. The current document is ${currentDocumentUuid}, visible tabs are ${visibleTabsLabel}, and the editor URL still targets project ${projectLabel}. Requested document ${documentUuid} is unlikely to open successfully in this bootstrap state. Reload or reopen the target project in the EasyEDA UI, then call get_current_context again before retrying open_document.`;
	}

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

function getActiveRequestedTab(hash: string): string | undefined {
	const requestedTabs = getRequestedTabIds(hash);
	if (requestedTabs.length === 0)
		return undefined;

	return requestedTabs.find(entry => entry.startsWith('*')) ?? requestedTabs[requestedTabs.length - 1];
}

function normalizeRequestedTabId(tabEntry: string): string {
	return tabEntry.startsWith('*') ? tabEntry.slice(1) : tabEntry;
}

function parseRequestedTab(tabEntry: string): { documentUuid?: string; projectUuid?: string } {
	const normalizedEntry = normalizeRequestedTabId(tabEntry);
	const [documentUuid, projectUuid] = normalizedEntry.split('@');
	return {
		documentUuid: documentUuid || undefined,
		projectUuid: projectUuid || undefined,
	};
}

function matchesRequestedTabId(tabId: string, requestedTabEntry: string): boolean {
	return tabId === normalizeRequestedTabId(requestedTabEntry);
}

function matchesRequestedDocumentIframe(
	iframe: EditorShellIframeDescriptor,
	documentUuid: string,
	projectUuid?: string,
): boolean {
	if (!iframe.id)
		return false;

	const expectedFramePrefix = `frame_${documentUuid}`;
	if (!iframe.id.startsWith(expectedFramePrefix))
		return false;

	if (!projectUuid)
		return true;

	return iframe.id === `${expectedFramePrefix}@${projectUuid}` || iframe.id.startsWith(`${expectedFramePrefix}@`);
}

function inferDocumentTypeFromIframeSrc(src: string | undefined): number | undefined {
	if (!src)
		return undefined;

	if (src.includes('entry=pcb'))
		return DOCUMENT_TYPE_PCB;
	if (src.includes('entry=sch'))
		return DOCUMENT_TYPE_SCHEMATIC_PAGE;
	if (src.includes('entry=panel'))
		return DOCUMENT_TYPE_PANEL;

	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
