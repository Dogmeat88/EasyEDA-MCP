import { z } from 'zod';

export const BoardEdgeSchema = z.enum(['NORTH', 'SOUTH', 'EAST', 'WEST']);

export interface LayoutScorecard {
	totalScore: number;
	metrics: {
		ratsnestLengthMm: number;
		viaCount: number;
		thermalIsolationScore: number;
	};
	constraints: {
		drcErrors: number;
		hasCollisions: boolean;
		isMatingSideClear: boolean;
	};
	metadata?: {
		connectorsConsidered?: number;
		obstructions?: Array<{
			connectorId: string;
			connectorDesignator?: string;
			obstructingComponentId: string;
			obstructingDesignator?: string;
			edge: z.infer<typeof BoardEdgeSchema>;
		}>;
		limitations?: string[];
	};
}

export const MoveComponentSchema = z.object({
	componentId: z.string().min(1),
	x: z.number(),
	y: z.number(),
	rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
