export interface BridgeSocketIdAllocation {
	socketId: string;
	nextSequence: number;
}

export function allocateBridgeSocketId(baseSocketId: string, currentSequence: number): BridgeSocketIdAllocation {
	const nextSequence = currentSequence + 1;
	return {
		socketId: nextSequence === 1 ? baseSocketId : `${baseSocketId}-${nextSequence}`,
		nextSequence,
	};
}

export function shouldHandleBridgeSocketCallback(activeSocketId: string | undefined, callbackSocketId: string): boolean {
	return activeSocketId === callbackSocketId;
}
