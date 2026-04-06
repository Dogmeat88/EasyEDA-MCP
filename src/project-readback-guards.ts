import { computeSourceRevision } from './mcp-bridge-protocol';

export interface PcbSourceSummary {
	sourceHash: string;
	componentCount: number;
	padNetCount: number;
	trackCount: number;
	textCount: number;
	viaCount: number;
	totalParsedEntries: number;
}

export interface PcbImportTargetSnapshot {
	boardFound: boolean;
	pcbFound: boolean;
	parentBoardName?: string;
	schematicPageUuid?: string;
	schematicUuid?: string;
	titleBlockBoardName?: string;
}

export function assertPcbCreationTargetAvailable(projectBoards: unknown[], boardName?: string): void {
	if (!boardName)
		return;

	const board = findProjectBoardByName(projectBoards, boardName);
	if (!board)
		return;

	const existingPcbUuid = getProjectBoardPcbUuid(board);
	if (existingPcbUuid) {
		throw new Error(
			`create_pcb cannot create another PCB for board ${boardName} because it is already linked to PCB ${existingPcbUuid}`,
		);
	}
}

export function verifyCreatedPcb(projectPcbs: unknown[], pcbUuid: string | undefined, expectedBoardName?: string): {
	parentBoardName?: string;
	readbackVerified: true;
} {
	if (!pcbUuid) {
		if (expectedBoardName)
			throw new Error(`EasyEDA reported PCB creation success for board ${expectedBoardName}, but did not return a PCB id`);

		throw new Error('EasyEDA reported PCB creation success, but did not return a PCB id');
	}

	const pcb = findProjectPcbByUuid(projectPcbs, pcbUuid);
	if (!pcb)
		throw new Error(`EasyEDA reported PCB creation success for ${pcbUuid}, but the PCB is missing from project inventory`);

	const parentBoardName = getProjectPcbParentBoardName(pcb);
	if (expectedBoardName && parentBoardName !== expectedBoardName) {
		throw new Error(
			`EasyEDA created PCB ${pcbUuid}, but readback shows parent board ${parentBoardName ?? 'none'} instead of ${expectedBoardName}`,
		);
	}

	return {
		parentBoardName,
		readbackVerified: true,
	};
}

export function verifyCreatedBoard(
	projectBoards: unknown[],
	boardName: string,
	expectedSchematicUuid?: string,
	expectedPcbUuid?: string,
): {
	actualSchematicUuid?: string;
	actualPcbUuid?: string;
	titleBlockBoardName?: string;
	readbackVerified: true;
} {
	const board = findProjectBoardByName(projectBoards, boardName);
	if (!board)
		throw new Error(`EasyEDA reported board creation success for ${boardName}, but the board is missing from project inventory`);

	const actualSchematicUuid = getProjectBoardSchematicUuid(board);
	if (expectedSchematicUuid && actualSchematicUuid !== expectedSchematicUuid) {
		throw new Error(
			`EasyEDA created board ${boardName}, but readback shows schematic ${actualSchematicUuid ?? 'none'} instead of ${expectedSchematicUuid}`,
		);
	}

	const actualPcbUuid = getProjectBoardPcbUuid(board);
	if (expectedPcbUuid && actualPcbUuid !== expectedPcbUuid) {
		throw new Error(
			`EasyEDA created board ${boardName}, but readback shows PCB ${actualPcbUuid ?? 'none'} instead of ${expectedPcbUuid}`,
		);
	}

	const titleBlockBoardName = getProjectBoardSchematicTitleBlockBoardName(board);
	if (expectedSchematicUuid && titleBlockBoardName && titleBlockBoardName !== boardName) {
		throw new Error(
			`EasyEDA created board ${boardName}, but the linked schematic still advertises board ${titleBlockBoardName} in its title block`,
		);
	}

	return {
		actualSchematicUuid,
		actualPcbUuid,
		titleBlockBoardName,
		readbackVerified: true,
	};
}

export function verifyPcbImportTarget(
	projectBoards: unknown[],
	projectPcbs: unknown[],
	pcbUuid: string,
): {
	parentBoardName: string;
	schematicUuid: string;
	titleBlockBoardName?: string;
	readbackVerified: true;
} {
	const snapshot = getPcbImportTargetSnapshot(projectBoards, projectPcbs, pcbUuid);
	if (!snapshot.pcbFound) {
		throw new Error(`import_schematic_to_pcb could not find PCB ${pcbUuid} in project inventory`);
	}

	const parentBoardName = snapshot.parentBoardName;
	if (!parentBoardName) {
		throw new Error(
			`import_schematic_to_pcb requires PCB ${pcbUuid} to belong to a board linked to a schematic, but readback shows no parent board`,
		);
	}

	if (!snapshot.boardFound) {
		throw new Error(
			`import_schematic_to_pcb requires PCB ${pcbUuid} to belong to a board linked to a schematic, but board ${parentBoardName} is missing from project inventory`,
		);
	}

	const schematicUuid = snapshot.schematicUuid;
	if (!schematicUuid) {
		throw new Error(
			`import_schematic_to_pcb requires PCB ${pcbUuid} to belong to a board linked to a schematic, but board ${parentBoardName} has no linked schematic`,
		);
	}

	const titleBlockBoardName = snapshot.titleBlockBoardName;
	if (titleBlockBoardName && titleBlockBoardName !== parentBoardName) {
		throw new Error(
			`import_schematic_to_pcb requires a coherent board/schematic link, but board ${parentBoardName} is backed by a schematic whose title block still advertises board ${titleBlockBoardName}`,
		);
	}

	return {
		parentBoardName,
		schematicUuid,
		titleBlockBoardName,
		readbackVerified: true,
	};
}

export function getPcbImportTargetSnapshot(
	projectBoards: unknown[],
	projectPcbs: unknown[],
	pcbUuid: string,
): PcbImportTargetSnapshot {
	const pcb = findProjectPcbByUuid(projectPcbs, pcbUuid);
	if (!pcb)
		return { boardFound: false, pcbFound: false };

	const parentBoardName = getProjectPcbParentBoardName(pcb);
	if (!parentBoardName)
		return { boardFound: false, pcbFound: true };

	const board = findProjectBoardByName(projectBoards, parentBoardName);
	if (!board)
		return { boardFound: false, pcbFound: true, parentBoardName };

	const schematicUuid = getProjectBoardSchematicUuid(board);
	const titleBlockBoardName = getProjectBoardSchematicTitleBlockBoardName(board);

	return {
		boardFound: true,
		pcbFound: true,
		parentBoardName,
		schematicPageUuid: getProjectBoardSchematicPageUuid(board),
		schematicUuid,
		titleBlockBoardName,
	};
}

export function getSchematicTitleBlockAttributeFromSource(source: string, attributeName: string): string | undefined {
	for (const line of source.split('\n')) {
		const parsed = parseSourceLine(line);
		if (!parsed)
			continue;

		if (parsed[0] !== 'ATTR' || parsed[3] !== attributeName)
			continue;

		return getOptionalString(parsed[4]);
	}

	return undefined;
}

export function getImportReadbackStatus(beforeSource: string, afterSource: string, allowEmptyResult: boolean): {
	beforeSummary: PcbSourceSummary;
	afterSummary: PcbSourceSummary;
	sourceChanged: boolean;
	readbackVerified: boolean;
} {
	const beforeSummary = summarizePcbDocumentSource(beforeSource);
	const afterSummary = summarizePcbDocumentSource(afterSource);
	const sourceChanged = beforeSummary.sourceHash !== afterSummary.sourceHash;

	return {
		beforeSummary,
		afterSummary,
		sourceChanged,
		readbackVerified: allowEmptyResult || !isEmptyImportedPcb(afterSummary) || sourceChanged,
	};
}

export function summarizePcbDocumentSource(source: string): PcbSourceSummary {
	const summary: PcbSourceSummary = {
		sourceHash: computeSourceRevision(source),
		componentCount: 0,
		padNetCount: 0,
		trackCount: 0,
		textCount: 0,
		viaCount: 0,
		totalParsedEntries: 0,
	};

	for (const line of source.split('\n')) {
		const parsed = parseSourceLine(line);
		if (!parsed)
			continue;

		summary.totalParsedEntries += 1;
		const tag = parsed[0];
		if (tag === 'COMPONENT')
			summary.componentCount += 1;
		else if (tag === 'PAD_NET')
			summary.padNetCount += 1;
		else if (tag === 'TRACK')
			summary.trackCount += 1;
		else if (tag === 'TEXT')
			summary.textCount += 1;
		else if (tag === 'VIA')
			summary.viaCount += 1;
	}

	return summary;
}

export function isEmptyImportedPcb(summary: PcbSourceSummary): boolean {
	return summary.componentCount === 0
		&& summary.padNetCount === 0
		&& summary.trackCount === 0
		&& summary.viaCount === 0;
}

function findProjectBoardByName(boards: unknown[], boardName: string): Record<string, unknown> | undefined {
	return boards.find((entry) => {
		if (!isRecord(entry))
			return false;

		return getFirstTrimmedString(entry, ['boardName', 'name']) === boardName;
	}) as Record<string, unknown> | undefined;
}

function findProjectPcbByUuid(pcbs: unknown[], pcbUuid: string): Record<string, unknown> | undefined {
	return pcbs.find((entry) => {
		if (!isRecord(entry))
			return false;

		return getFirstTrimmedString(entry, ['uuid', 'pcbUuid']) === pcbUuid;
	}) as Record<string, unknown> | undefined;
}

function getProjectBoardSchematicUuid(board: Record<string, unknown>): string | undefined {
	return getNestedTrimmedString(board, [
		['schematic', 'uuid'],
		['schematic', 'schematicUuid'],
		['schematicUuid'],
	]);
}

function getProjectBoardPcbUuid(board: Record<string, unknown>): string | undefined {
	return getNestedTrimmedString(board, [
		['pcb', 'uuid'],
		['pcb', 'pcbUuid'],
		['pcbUuid'],
	]);
}

function getProjectBoardSchematicTitleBlockBoardName(board: Record<string, unknown>): string | undefined {
	const schematic = isRecord(board.schematic) ? board.schematic : undefined;
	const pages = Array.isArray(schematic?.page) ? schematic.page : [];

	for (const entry of pages) {
		const page = isRecord(entry) ? entry : undefined;
		const titleBlockBoardName = getTitleBlockValue(page?.titleBlockData, '@Board Name');
		if (titleBlockBoardName)
			return titleBlockBoardName;
	}

	return undefined;
}

function getProjectBoardSchematicPageUuid(board: Record<string, unknown>): string | undefined {
	const schematic = isRecord(board.schematic) ? board.schematic : undefined;
	const pages = Array.isArray(schematic?.page) ? schematic.page : [];

	for (const entry of pages) {
		const page = isRecord(entry) ? entry : undefined;
		const pageUuid = getOptionalString(page?.uuid);
		if (pageUuid)
			return pageUuid;
	}

	return undefined;
}

function getProjectPcbParentBoardName(pcb: Record<string, unknown>): string | undefined {
	return getNestedTrimmedString(pcb, [
		['parentBoardName'],
		['boardName'],
		['board', 'boardName'],
		['board', 'name'],
	]);
}

function getNestedTrimmedString(value: unknown, paths: string[][]): string | undefined {
	for (const path of paths) {
		let current: unknown = value;
		let resolved = true;

		for (const segment of path) {
			if (!isRecord(current)) {
				resolved = false;
				break;
			}

			current = current[segment];
		}

		const candidate = getOptionalString(current);
		if (resolved && candidate)
			return candidate;
	}

	return undefined;
}

function getFirstTrimmedString(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const candidate = getOptionalString(record[key]);
		if (candidate)
			return candidate;
	}

	return undefined;
}

function getTitleBlockValue(titleBlockData: unknown, key: string): string | undefined {
	const titleBlockRecord = isRecord(titleBlockData) ? titleBlockData : undefined;
	const entry = isRecord(titleBlockRecord?.[key]) ? titleBlockRecord[key] as Record<string, unknown> : undefined;
	return getOptionalString(entry?.value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getOptionalString(value: unknown): string | undefined {
	if (typeof value !== 'string')
		return undefined;

	const trimmedValue = value.trim();
	return trimmedValue || undefined;
}
