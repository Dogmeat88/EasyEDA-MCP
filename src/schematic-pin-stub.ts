export interface SchematicPinStubLike {
	getState_X: () => number;
	getState_Y: () => number;
	getState_Rotation: () => number;
	getState_PinLength?: () => number;
}

export function buildSchematicPinStubLine(
	pin: SchematicPinStubLike,
	labelOffsetX?: number,
	labelOffsetY?: number,
): [number, number, number, number] {
	const startX = pin.getState_X();
	const startY = pin.getState_Y();
	const hasExplicitOffset = labelOffsetX !== undefined || labelOffsetY !== undefined;
	if (hasExplicitOffset) {
		return [
			startX,
			startY,
			startX + (labelOffsetX ?? 0),
			startY + (labelOffsetY ?? 0),
		];
	}

	const stubLength = Math.max(pin.getState_PinLength?.() ?? 0, 20);
	switch (((pin.getState_Rotation() % 360) + 360) % 360) {
		case 180:
			return [startX, startY, startX - stubLength, startY];
		case 90:
			return [startX, startY, startX, startY - stubLength];
		case 270:
			return [startX, startY, startX, startY + stubLength];
		case 0:
		default:
			return [startX, startY, startX + stubLength, startY];
	}
}
