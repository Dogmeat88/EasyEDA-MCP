import type { EasyedaBridgeCaller } from './mcp-tool-types';
import type { LayoutScorecard } from './types';

interface AlignToBoardEdgeArgs {
	componentId: string;
	edge: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';
	clearance: number;
	saveAfter?: boolean;
}

interface LayoutFitnessArgs {
	connectorDesignatorPrefixes?: string[];
	matingSideDepth?: number;
}

interface NormalizedBBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
	centerX: number;
	centerY: number;
}

interface ComponentPlacement {
	primitiveId: string;
	designator?: string;
	bbox: NormalizedBBox;
	isConnector: boolean;
}

const DEFAULT_CONNECTOR_PREFIXES = ['J'];
const DEFAULT_MATING_SIDE_DEPTH = 15;

export async function alignToBoardEdge(
	bridgeSession: EasyedaBridgeCaller,
	args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const { componentId, edge, clearance, saveAfter } = parseAlignArgs(args);
	const boardBounds = await getBoardBounds(bridgeSession);
	const beforeBounds = await getPrimitiveBounds(bridgeSession, componentId);
	const nextCenter = {
		x: beforeBounds.centerX,
		y: beforeBounds.centerY,
	};

	switch (edge) {
		case 'NORTH':
			nextCenter.y = boardBounds.top + clearance + beforeBounds.height / 2;
			break;
		case 'SOUTH':
			nextCenter.y = boardBounds.bottom - clearance - beforeBounds.height / 2;
			break;
		case 'WEST':
			nextCenter.x = boardBounds.left + clearance + beforeBounds.width / 2;
			break;
		case 'EAST':
			nextCenter.x = boardBounds.right - clearance - beforeBounds.width / 2;
			break;
	}

	const moveResult = asRecord(await bridgeSession.call('modify_pcb_component', {
		primitiveId: componentId,
		x: nextCenter.x,
		y: nextCenter.y,
		saveAfter,
	}));
	const afterBounds = await getPrimitiveBounds(bridgeSession, componentId);

	return {
		componentId,
		edge,
		clearance,
		boardBounds,
		before: beforeBounds,
		after: afterBounds,
		targetCenter: nextCenter,
		moveDelta: {
			x: roundTo(afterBounds.centerX - beforeBounds.centerX),
			y: roundTo(afterBounds.centerY - beforeBounds.centerY),
		},
		readbackVerified: isAlignedToEdge(afterBounds, boardBounds, edge, clearance),
		saved: moveResult?.saved,
		moveResult,
	};
}

export async function getLayoutFitnessScore(
	bridgeSession: EasyedaBridgeCaller,
	args: Record<string, unknown>,
): Promise<LayoutScorecard & Record<string, unknown>> {
	const { connectorDesignatorPrefixes, matingSideDepth } = parseFitnessArgs(args);
	const [netsResponse, viaResponse, drcResponse, componentPlacements, boardBounds] = await Promise.all([
		asRecord(await bridgeSession.call('list_pcb_nets')),
		getViaPrimitiveInventory(bridgeSession),
		asRecord(await bridgeSession.call('run_pcb_drc', { strict: true, showUi: false })),
		listComponentPlacements(bridgeSession, connectorDesignatorPrefixes),
		getBoardBoundsOrUndefined(bridgeSession),
	]);

	const netNames = Array.isArray(netsResponse?.names)
		? netsResponse.names.filter((value): value is string => typeof value === 'string')
		: [];
	const netDetails = await Promise.all(netNames.map(async (net) => {
		const response = asRecord(await bridgeSession.call('get_pcb_net', { net }));
		return {
			net,
			length: extractNetLength(response),
		};
	}));

	const ratsnestLengthMm = roundTo(netDetails.reduce((sum, detail) => sum + detail.length, 0));
	const viaCount = getFiniteNumber(viaResponse?.count) ?? 0;
	const drcErrors = getFiniteNumber(drcResponse?.issueCount) ?? 0;
	const categories = Array.isArray(drcResponse?.categories) ? drcResponse.categories : [];
	const hasCollisions = drcErrors > 0 || categories.some((entry) => /collision|overlap|track|pad|hole|line/i.test(String(asRecord(entry)?.label ?? '')));
	const matingSideResult = evaluateMatingSideClearance(componentPlacements, boardBounds, matingSideDepth);
	const thermalIsolationScore = computeThermalIsolationScore({
		ratsnestLengthMm,
		viaCount,
		drcErrors,
		isMatingSideClear: matingSideResult.isMatingSideClear,
	});
	const totalScore = computeTotalScore({
		ratsnestLengthMm,
		viaCount,
		thermalIsolationScore,
		drcErrors,
		hasCollisions,
		isMatingSideClear: matingSideResult.isMatingSideClear,
	});

	return {
		totalScore,
		metrics: {
			ratsnestLengthMm,
			viaCount,
			thermalIsolationScore,
		},
		constraints: {
			drcErrors,
			hasCollisions,
			isMatingSideClear: matingSideResult.isMatingSideClear,
		},
		metadata: {
			connectorsConsidered: matingSideResult.connectorsConsidered,
			obstructions: matingSideResult.obstructions,
			limitations: [
				'Ratsnest length is currently derived from EasyEDA net-length readback and depends on host units matching millimeters.',
				'Thermal isolation is currently a heuristic score derived from congestion, vias, and DRC state rather than copper thermal simulation.',
				'Mating-side clearance checks use connector designator prefixes and board-outline bounding boxes, not 3D enclosure geometry.',
			],
		},
		netLengths: netDetails,
		connectorDesignatorPrefixes,
		matingSideDepth,
		boardBounds,
	};
}

function parseAlignArgs(args: Record<string, unknown>): AlignToBoardEdgeArgs {
	const componentId = typeof args.componentId === 'string' ? args.componentId : undefined;
	const edge = typeof args.edge === 'string' ? args.edge : undefined;
	const rawClearance = typeof args.clearance === 'number' ? args.clearance : undefined;
	if (!componentId)
		throw new Error('componentId is required');
	if (edge !== 'NORTH' && edge !== 'SOUTH' && edge !== 'EAST' && edge !== 'WEST')
		throw new Error('edge must be one of NORTH, SOUTH, EAST, WEST');
	if (rawClearance === undefined || !Number.isFinite(rawClearance) || rawClearance < 0)
		throw new Error('clearance must be a non-negative number');

	const clearance: number = rawClearance;

	return {
		componentId,
		edge,
		clearance,
		saveAfter: typeof args.saveAfter === 'boolean' ? args.saveAfter : undefined,
	};
}

function parseFitnessArgs(args: Record<string, unknown>): Required<LayoutFitnessArgs> {
	const connectorDesignatorPrefixes = Array.isArray(args.connectorDesignatorPrefixes)
		? args.connectorDesignatorPrefixes.filter((value): value is string => typeof value === 'string' && value.length > 0)
		: DEFAULT_CONNECTOR_PREFIXES;
	const matingSideDepth = typeof args.matingSideDepth === 'number' && Number.isFinite(args.matingSideDepth) && args.matingSideDepth > 0
		? args.matingSideDepth
		: DEFAULT_MATING_SIDE_DEPTH;

	return {
		connectorDesignatorPrefixes: connectorDesignatorPrefixes.length > 0 ? connectorDesignatorPrefixes : DEFAULT_CONNECTOR_PREFIXES,
		matingSideDepth,
	};
}

async function getBoardBounds(bridgeSession: EasyedaBridgeCaller): Promise<NormalizedBBox> {
	const boardBounds = await getBoardBoundsOrUndefined(bridgeSession);
	if (!boardBounds)
		throw new Error('Board outline is required before using layout edge alignment or mating-side scoring');

	return boardBounds;
}

async function getBoardBoundsOrUndefined(bridgeSession: EasyedaBridgeCaller): Promise<NormalizedBBox | undefined> {
	const lineIdsResponse = asRecord(await bridgeSession.call('list_pcb_primitive_ids', {
		family: 'line',
		layer: 'BoardOutLine',
	}));
	const primitiveIds = Array.isArray(lineIdsResponse?.primitiveIds)
		? lineIdsResponse.primitiveIds.filter((value): value is string => typeof value === 'string')
		: [];
	if (primitiveIds.length === 0)
		return undefined;

	return getPrimitiveGroupBounds(bridgeSession, primitiveIds);
}

async function getPrimitiveBounds(bridgeSession: EasyedaBridgeCaller, primitiveId: string): Promise<NormalizedBBox> {
	return getPrimitiveGroupBounds(bridgeSession, [primitiveId]);
}

async function getPrimitiveGroupBounds(bridgeSession: EasyedaBridgeCaller, primitiveIds: string[]): Promise<NormalizedBBox> {
	const bboxResponse = asRecord(await bridgeSession.call('get_pcb_primitives_bbox', { primitiveIds }));
	const bbox = normalizeBBox(bboxResponse?.bbox);
	if (!bbox)
		throw new Error(`EasyEDA bridge returned an invalid PCB bounding box for ${primitiveIds.join(', ')}`);

	return bbox;
}

async function listComponentPlacements(
	bridgeSession: EasyedaBridgeCaller,
	connectorDesignatorPrefixes: string[],
): Promise<ComponentPlacement[]> {
	const designatorMap = await getComponentDesignatorsFromSource(bridgeSession);
	const componentIdsResponse = asRecord(await bridgeSession.call('list_pcb_primitive_ids', { family: 'component' }));
	const primitiveIds = Array.isArray(componentIdsResponse?.primitiveIds)
		? componentIdsResponse.primitiveIds.filter((value): value is string => typeof value === 'string')
		: [];

	return Promise.all(primitiveIds.map(async (primitiveId) => {
		const [primitiveResponse, bbox] = await Promise.all([
			asRecord(await bridgeSession.call('get_pcb_primitive', { primitiveId })),
			getPrimitiveBounds(bridgeSession, primitiveId),
		]);
		const primitive = asRecord(primitiveResponse?.primitive);
		const designator = designatorMap.get(primitiveId) ?? extractDesignator(primitive);
		return {
			primitiveId,
			designator,
			bbox,
			isConnector: matchesDesignatorPrefix(designator, connectorDesignatorPrefixes),
		};
	}));
}

async function getComponentDesignatorsFromSource(bridgeSession: EasyedaBridgeCaller): Promise<Map<string, string>> {
	const response = asRecord(await bridgeSession.call('get_document_source'));
	const source = typeof response?.source === 'string' ? response.source : '';
	const designatorMap = new Map<string, string>();

	for (const line of source.split('\n')) {
		const parsed = parseSourceLine(line);
		if (!parsed || parsed[0] !== 'ATTR')
			continue;

		const ownerId = typeof parsed[3] === 'string' ? parsed[3] : undefined;
		const attrName = typeof parsed[7] === 'string' ? parsed[7] : undefined;
		const attrValue = typeof parsed[8] === 'string' ? parsed[8] : undefined;
		if (ownerId && attrName === 'Designator' && attrValue)
			designatorMap.set(ownerId, attrValue);
	}

	return designatorMap;
}

function evaluateMatingSideClearance(
	components: ComponentPlacement[],
	boardBounds: NormalizedBBox | undefined,
	matingSideDepth: number,
): {
	isMatingSideClear: boolean;
	connectorsConsidered: number;
	obstructions: Array<{
		connectorId: string;
		connectorDesignator?: string;
		obstructingComponentId: string;
		obstructingDesignator?: string;
		edge: AlignToBoardEdgeArgs['edge'];
	}>;
} {
	const connectors = components.filter(component => component.isConnector);
	if (connectors.length === 0) {
		return {
			isMatingSideClear: true,
			connectorsConsidered: 0,
			obstructions: [],
		};
	}

	if (!boardBounds) {
		return {
			isMatingSideClear: false,
			connectorsConsidered: connectors.length,
			obstructions: [],
		};
	}

	const obstructions = connectors.flatMap((connector) => {
		const edge = getNearestBoardEdge(connector.bbox, boardBounds);
		const corridor = getMatingSideCorridor(connector.bbox, boardBounds, edge, matingSideDepth);
		return components
			.filter(candidate => candidate.primitiveId !== connector.primitiveId && !candidate.isConnector)
			.filter(candidate => boxesOverlap(candidate.bbox, corridor))
			.map(candidate => ({
				connectorId: connector.primitiveId,
				connectorDesignator: connector.designator,
				obstructingComponentId: candidate.primitiveId,
				obstructingDesignator: candidate.designator,
				edge,
			}));
	});

	return {
		isMatingSideClear: obstructions.length === 0,
		connectorsConsidered: connectors.length,
		obstructions,
	};
}

function getNearestBoardEdge(bbox: NormalizedBBox, boardBounds: NormalizedBBox): AlignToBoardEdgeArgs['edge'] {
	const distances = [
		{ edge: 'NORTH' as const, distance: Math.abs(bbox.top - boardBounds.top) },
		{ edge: 'SOUTH' as const, distance: Math.abs(boardBounds.bottom - bbox.bottom) },
		{ edge: 'WEST' as const, distance: Math.abs(bbox.left - boardBounds.left) },
		{ edge: 'EAST' as const, distance: Math.abs(boardBounds.right - bbox.right) },
	];
	distances.sort((left, right) => left.distance - right.distance);
	return distances[0].edge;
}

function getMatingSideCorridor(
	connectorBounds: NormalizedBBox,
	boardBounds: NormalizedBBox,
	edge: AlignToBoardEdgeArgs['edge'],
	matingSideDepth: number,
): NormalizedBBox {
	switch (edge) {
		case 'NORTH':
			return createBBox(connectorBounds.left, boardBounds.top, connectorBounds.right, Math.min(boardBounds.bottom, boardBounds.top + matingSideDepth));
		case 'SOUTH':
			return createBBox(connectorBounds.left, Math.max(boardBounds.top, boardBounds.bottom - matingSideDepth), connectorBounds.right, boardBounds.bottom);
		case 'WEST':
			return createBBox(boardBounds.left, connectorBounds.top, Math.min(boardBounds.right, boardBounds.left + matingSideDepth), connectorBounds.bottom);
		case 'EAST':
			return createBBox(Math.max(boardBounds.left, boardBounds.right - matingSideDepth), connectorBounds.top, boardBounds.right, connectorBounds.bottom);
	}
	}

function createBBox(left: number, top: number, right: number, bottom: number): NormalizedBBox {
	return normalizeBBox({ left, top, right, bottom }) as NormalizedBBox;
}

function boxesOverlap(left: NormalizedBBox, right: NormalizedBBox): boolean {
	return left.left < right.right
		&& left.right > right.left
		&& left.top < right.bottom
		&& left.bottom > right.top;
}

function isAlignedToEdge(
	bounds: NormalizedBBox,
	boardBounds: NormalizedBBox,
	edge: AlignToBoardEdgeArgs['edge'],
	clearance: number,
): boolean {
	const tolerance = 0.01;
	switch (edge) {
		case 'NORTH':
			return Math.abs(bounds.top - (boardBounds.top + clearance)) <= tolerance;
		case 'SOUTH':
			return Math.abs(bounds.bottom - (boardBounds.bottom - clearance)) <= tolerance;
		case 'WEST':
			return Math.abs(bounds.left - (boardBounds.left + clearance)) <= tolerance;
		case 'EAST':
			return Math.abs(bounds.right - (boardBounds.right - clearance)) <= tolerance;
	}
	}

function computeThermalIsolationScore(args: {
	ratsnestLengthMm: number;
	viaCount: number;
	drcErrors: number;
	isMatingSideClear: boolean;
}): number {
	let score = 100;
	score -= Math.min(35, args.ratsnestLengthMm / 8);
	score -= Math.min(20, args.viaCount * 2);
	score -= Math.min(40, args.drcErrors * 12);
	if (!args.isMatingSideClear)
		score -= 15;
	return roundTo(clamp(score, 0, 100));
}

function computeTotalScore(args: {
	ratsnestLengthMm: number;
	viaCount: number;
	thermalIsolationScore: number;
	drcErrors: number;
	hasCollisions: boolean;
	isMatingSideClear: boolean;
}): number {
	let score = 100;
	score -= Math.min(40, args.ratsnestLengthMm / 6);
	score -= Math.min(15, args.viaCount * 1.5);
	score += args.thermalIsolationScore * 0.15;
	score -= Math.min(50, args.drcErrors * 20);
	if (args.hasCollisions)
		score -= 15;
	if (!args.isMatingSideClear)
		score -= 10;
	return roundTo(clamp(score, 0, 100));
}

function extractNetLength(response: Record<string, unknown> | undefined): number {
	const direct = getFiniteNumber(response?.length);
	if (typeof direct === 'number')
		return direct;

	const details = asRecord(response?.details);
	for (const key of ['length', 'lengthMm', 'routedLength', 'routedLengthMm', 'totalLength', 'totalLengthMm']) {
		const value = getFiniteNumber(details?.[key]);
		if (typeof value === 'number')
			return value;
	}

	return 0;
}

function matchesDesignatorPrefix(designator: string | undefined, prefixes: string[]): boolean {
	if (!designator)
		return false;

	const upperDesignator = designator.toUpperCase();
	return prefixes.some(prefix => upperDesignator.startsWith(prefix.toUpperCase()));
}

async function getViaPrimitiveInventory(bridgeSession: EasyedaBridgeCaller): Promise<Record<string, unknown> | undefined> {
	try {
		return asRecord(await bridgeSession.call('list_pcb_primitive_ids', { family: 'via' }));
	}
	catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/Unsupported PCB primitive family: via/i.test(message))
			return { count: 0, primitiveIds: [], unsupported: true };

		throw error;
	}
}

function extractDesignator(primitive: Record<string, unknown> | undefined): string | undefined {
	if (!primitive)
		return undefined;

	for (const key of ['designator', 'Designator', 'ref', 'Ref', 'reference']) {
		if (typeof primitive[key] === 'string' && primitive[key])
			return primitive[key] as string;
	}

	for (const nestedKey of ['head', 'otherProperty', 'attrs', 'attributes']) {
		const nested = asRecord(primitive[nestedKey]);
		if (!nested)
			continue;
		for (const key of ['designator', 'Designator', 'ref', 'Ref', 'reference']) {
			if (typeof nested[key] === 'string' && nested[key])
				return nested[key] as string;
		}
	}

	return undefined;
}

function normalizeBBox(value: unknown): NormalizedBBox | undefined {
	if (Array.isArray(value)) {
		const numbers = value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
		if (numbers.length >= 4)
			return createNormalizedBBox(numbers[0], numbers[1], numbers[2], numbers[3]);
	}

	const record = asRecord(value);
	if (!record)
		return undefined;

	const left = getFiniteNumber(record.left) ?? getFiniteNumber(record.minX) ?? getFiniteNumber(record.x1);
	const right = getFiniteNumber(record.right) ?? getFiniteNumber(record.maxX) ?? getFiniteNumber(record.x2);
	const top = getFiniteNumber(record.top) ?? getFiniteNumber(record.minY) ?? getFiniteNumber(record.y1);
	const bottom = getFiniteNumber(record.bottom) ?? getFiniteNumber(record.maxY) ?? getFiniteNumber(record.y2);
	if (left !== undefined && right !== undefined && top !== undefined && bottom !== undefined)
		return createNormalizedBBox(left, top, right, bottom);

	const x = getFiniteNumber(record.x);
	const y = getFiniteNumber(record.y);
	const width = getFiniteNumber(record.width);
	const height = getFiniteNumber(record.height);
	if (x !== undefined && y !== undefined && width !== undefined && height !== undefined)
		return createNormalizedBBox(x, y, x + width, y + height);

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

function createNormalizedBBox(left: number, top: number, right: number, bottom: number): NormalizedBBox {
	const normalizedLeft = Math.min(left, right);
	const normalizedRight = Math.max(left, right);
	const normalizedTop = Math.min(top, bottom);
	const normalizedBottom = Math.max(top, bottom);
	return {
		left: normalizedLeft,
		right: normalizedRight,
		top: normalizedTop,
		bottom: normalizedBottom,
		width: normalizedRight - normalizedLeft,
		height: normalizedBottom - normalizedTop,
		centerX: (normalizedLeft + normalizedRight) / 2,
		centerY: (normalizedTop + normalizedBottom) / 2,
	};
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function roundTo(value: number, decimals = 2): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

function getFiniteNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value))
		return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}
