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

export function verifyCreatedPcb(projectPcbs: unknown[], pcbUuid: string, expectedBoardName?: string): {
	parentBoardName?: string;
	readbackVerified: true;
} {
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

	return {
		actualSchematicUuid,
		actualPcbUuid,
		readbackVerified: true,
	};
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