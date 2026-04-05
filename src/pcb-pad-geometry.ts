type PcbComponentPadReference = {
	primitiveId?: unknown;
	padNumber?: unknown;
};

type PcbComponentWithPads = {
	pads?: unknown;
};

type PcbPadStateLike = {
	getState_PrimitiveId(): string;
	getState_PadNumber(): string;
};

function asPadReference(value: unknown): PcbComponentPadReference | undefined {
	if (!value || typeof value !== 'object')
		return undefined;

	return value as PcbComponentPadReference;
}

export function findPcbComponentPadPrimitiveId(component: PcbComponentWithPads | undefined, padNumber: string): string | undefined {
	const pads = component?.pads;
	if (!Array.isArray(pads))
		return undefined;

	for (const value of pads) {
		const candidate = asPadReference(value);
		if (!candidate)
			continue;

		if (candidate.padNumber !== padNumber)
			continue;

		return typeof candidate.primitiveId === 'string' ? candidate.primitiveId : undefined;
	}

	return undefined;
}

export function findResolvedPcbPad<TPad extends PcbPadStateLike>(
	componentPrimitiveId: string,
	padNumber: string,
	component: PcbComponentWithPads | undefined,
	allPads: TPad[],
): TPad | undefined {
	const expectedPrimitiveId = findPcbComponentPadPrimitiveId(component, padNumber);
	if (expectedPrimitiveId) {
		const exactPad = allPads.find(candidate => candidate.getState_PrimitiveId() === expectedPrimitiveId);
		if (exactPad)
			return exactPad;
	}

	const componentScopedPad = allPads.find(candidate => candidate.getState_PrimitiveId().startsWith(componentPrimitiveId) && candidate.getState_PadNumber() === padNumber);
	if (componentScopedPad)
		return componentScopedPad;

	return allPads.find(candidate => candidate.getState_PadNumber() === padNumber);
}