export const PCB_BOARD_OUTLINE_LAYER = 'BoardOutLine';

export function getOptionalTrimmedStringIncludingEmpty(value: unknown): string | undefined {
	if (typeof value !== 'string')
		return undefined;

	return value.trim();
}

export function resolvePcbLineNetForCreate(layer: string, net: unknown): string {
	const normalizedNet = getOptionalTrimmedStringIncludingEmpty(net);
	if (layer === PCB_BOARD_OUTLINE_LAYER)
		return normalizedNet ?? '';

	if (!normalizedNet)
		throw new Error('Expected a non-empty string for net');

	return normalizedNet;
}
