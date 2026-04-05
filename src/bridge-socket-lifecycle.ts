export function allocateBridgeSocketId(baseSocketId: string, currentSequence: number): { socketId: string, nextSequence: number } {
	const nextSequence = currentSequence + 1;
	return {
		socketId: nextSequence === 1 ? baseSocketId : `${baseSocketId}-${nextSequence}`,
		nextSequence,
	};
}

export function shouldHandleBridgeSocketCallback(activeSocketId: string | undefined, callbackSocketId: string): boolean {
	return activeSocketId === callbackSocketId;
}