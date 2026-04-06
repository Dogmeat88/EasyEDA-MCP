const PCB_LINE_LAYER_ID_BY_NAME: Record<string, number> = {
	TopLayer: 1,
	BottomLayer: 2,
	TopSilkscreen: 3,
	BottomSilkscreen: 4,
	TopSolderMask: 5,
	BottomSolderMask: 6,
	TopPasteMask: 7,
	BottomPasteMask: 8,
	TopAssembly: 9,
	BottomAssembly: 10,
	BoardOutLine: 11,
	MultiLayer: 12,
	Document: 13,
	Mechanical: 14,
	DrillDrawing: 56,
	Ratline: 57,
};

export function normalizePcbLineLayerForHost<TLayer>(layer: TLayer): TLayer | number {
	if (typeof layer !== 'string')
		return layer;

	return PCB_LINE_LAYER_ID_BY_NAME[layer] ?? layer;
}