export interface PcbPadRouteAnchorPad {
	getState_X(): number;
	getState_Y(): number;
	getState_Rotation(): number;
	getState_Diameter?(): number;
	getState_HoleDiameter?(): number;
	getState_Hole?(): unknown;
	getState_Pad?(): unknown;
	getState_Width?(): number;
	getState_Height?(): number;
}

interface Point {
	x: number;
	y: number;
}

const DEFAULT_PAD_ROUTE_EXTENT = 10;
const MIN_PAD_ROUTE_INSET = 1;

export function getPcbPadRouteAnchor(
	pad: PcbPadRouteAnchorPad,
	toward: Point,
	lineWidth?: number,
): Point {
	const center = { x: pad.getState_X(), y: pad.getState_Y() };
	const deltaX = toward.x - center.x;
	const deltaY = toward.y - center.y;
	const distance = Math.hypot(deltaX, deltaY);
	if (!Number.isFinite(distance) || distance === 0)
		return center;

	const symmetricPadAnchor = getSymmetricPadRouteAnchor(pad, center, deltaX, deltaY, lineWidth);
	if (symmetricPadAnchor)
		return symmetricPadAnchor;

	const unitX = deltaX / distance;
	const unitY = deltaY / distance;
	const extent = getPadExtentAlongDirection(pad, unitX, unitY);
	const inset = Math.max(
		MIN_PAD_ROUTE_INSET,
		Math.min(extent * 0.25, (lineWidth ?? DEFAULT_PAD_ROUTE_EXTENT) / 2),
	);
	const anchorDistance = Math.max(0, extent - inset);

	return {
		x: center.x + unitX * anchorDistance,
		y: center.y + unitY * anchorDistance,
	};
}

function getSymmetricPadRouteAnchor(
	pad: PcbPadRouteAnchorPad,
	center: Point,
	deltaX: number,
	deltaY: number,
	lineWidth?: number,
): Point | undefined {
	const { width, height } = getPadSize(pad);
	const symmetricExtent = width && height && Math.abs(width - height) <= 1e-6 ? width / 2 : undefined;
	const diameter = getPadDiameter(pad, width, height);
	const holeDiameter = getPadHoleDiameter(pad);
	const radius = diameter ? diameter / 2 : holeDiameter ? holeDiameter / 2 + DEFAULT_PAD_ROUTE_EXTENT / 2 : symmetricExtent;
	if (!radius)
		return undefined;

	const inset = Math.max(
		MIN_PAD_ROUTE_INSET,
		Math.min(radius * 0.25, (lineWidth ?? DEFAULT_PAD_ROUTE_EXTENT) / 2),
	);
	const anchorDistance = Math.max(0, radius - inset);
	if (Math.abs(deltaX) >= Math.abs(deltaY)) {
		return {
			x: center.x + Math.sign(deltaX || 1) * anchorDistance,
			y: center.y,
		};
	}

	return {
		x: center.x,
		y: center.y + Math.sign(deltaY || 1) * anchorDistance,
	};
}

function getPadExtentAlongDirection(pad: PcbPadRouteAnchorPad, unitX: number, unitY: number): number {
	const { width, height } = getPadSize(pad);
	if (width && height)
		return Math.max(getRectExtentAlongDirection(width, height, pad.getState_Rotation(), unitX, unitY), MIN_PAD_ROUTE_INSET);

	const diameter = getPadDiameter(pad, width, height);
	if (diameter)
		return Math.max(diameter / 2, MIN_PAD_ROUTE_INSET);

	const holeDiameter = getPadHoleDiameter(pad);
	if (holeDiameter)
		return Math.max(holeDiameter / 2 + DEFAULT_PAD_ROUTE_EXTENT / 2, MIN_PAD_ROUTE_INSET);

	return DEFAULT_PAD_ROUTE_EXTENT;
}

function getPadSize(pad: PcbPadRouteAnchorPad): { width?: number; height?: number } {
	const width = callOptionalNumberGetter(pad, 'getState_Width');
	const height = callOptionalNumberGetter(pad, 'getState_Height');
	if (width && height)
		return { width, height };

	const tuple = callOptionalUnknownGetter(pad, 'getState_Pad');
	const parsed = parsePadShapeTuple(tuple);
	if (parsed)
		return { width: parsed.width, height: parsed.height };

	return {};
}

function getPadDiameter(pad: PcbPadRouteAnchorPad, width?: number, height?: number): number | undefined {
	const diameter = callOptionalNumberGetter(pad, 'getState_Diameter');
	if (diameter)
		return diameter;

	if (width && height && Math.abs(width - height) <= 1e-6)
		return width;

	return undefined;
}

function getPadHoleDiameter(pad: PcbPadRouteAnchorPad): number | undefined {
	const holeDiameter = callOptionalNumberGetter(pad, 'getState_HoleDiameter');
	if (holeDiameter)
		return holeDiameter;

	const tuple = callOptionalUnknownGetter(pad, 'getState_Hole');
	const parsed = parsePadShapeTuple(tuple);
	if (parsed && Math.abs(parsed.width - parsed.height) <= 1e-6)
		return parsed.width;

	return undefined;
}

function getRectExtentAlongDirection(
	width: number,
	height: number,
	rotationDegrees: number,
	unitX: number,
	unitY: number,
): number {
	const rotationRadians = Math.abs(rotationDegrees) <= Math.PI * 2
		? rotationDegrees
		: rotationDegrees * (Math.PI / 180);
	const localX = unitX * Math.cos(rotationRadians) + unitY * Math.sin(rotationRadians);
	const localY = -unitX * Math.sin(rotationRadians) + unitY * Math.cos(rotationRadians);
	const halfWidth = width / 2;
	const halfHeight = height / 2;
	const scale = Math.max(
		halfWidth > 0 ? Math.abs(localX) / halfWidth : 0,
		halfHeight > 0 ? Math.abs(localY) / halfHeight : 0,
	);
	if (scale === 0)
		return DEFAULT_PAD_ROUTE_EXTENT;

	return 1 / scale;
}

function parsePadShapeTuple(value: unknown): { width: number; height: number } | undefined {
	if (!Array.isArray(value) || value.length < 3)
		return undefined;

	const width = value[1];
	const height = value[2];
	if (typeof width !== 'number' || !Number.isFinite(width) || typeof height !== 'number' || !Number.isFinite(height))
		return undefined;

	return { width, height };
}

function callOptionalNumberGetter<T extends object>(value: T, methodName: keyof T | string): number | undefined {
	const candidate = value as T & Record<string, unknown>;
	const method = candidate[methodName];
	if (typeof method !== 'function')
		return undefined;

	const result = (method as () => unknown).call(value);
	return typeof result === 'number' && Number.isFinite(result) ? result : undefined;
}

function callOptionalUnknownGetter<T extends object>(value: T, methodName: keyof T | string): unknown {
	const candidate = value as T & Record<string, unknown>;
	const method = candidate[methodName];
	if (typeof method !== 'function')
		return undefined;

	return (method as () => unknown).call(value);
}