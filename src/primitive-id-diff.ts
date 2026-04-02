export function findAddedPrimitiveIds(previousPrimitiveIds: string[], nextPrimitiveIds: string[]): string[] {
	const previousPrimitiveIdSet = new Set(previousPrimitiveIds);
	return nextPrimitiveIds.filter(primitiveId => !previousPrimitiveIdSet.has(primitiveId));
}
