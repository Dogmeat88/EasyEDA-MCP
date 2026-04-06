export function buildPcbPolylineSource(points: Array<{ x: number; y: number }>): Array<number | 'L'> {
	if (points.length < 2)
		throw new Error('At least two points are required to build a PCB polyline');

	const [firstPoint, ...remainingPoints] = points;
	const source: Array<number | 'L'> = [firstPoint.x, firstPoint.y];

	for (const point of remainingPoints) {
		source.push('L', point.x, point.y);
	}

	return source;
}
