export async function withHostMethodTimeout<T>(
	label: string,
	timeoutMs: number,
	operation: () => Promise<T>,
	hint?: string,
): Promise<T> {
	let timeoutHandle: unknown;

	try {
		return await Promise.race([
			operation(),
			new Promise<T>((_, reject) => {
				timeoutHandle = scheduleRuntimeTimeout(() => {
					const suffix = hint ? ` ${hint}` : '';
					reject(new Error(`${label} timed out after ${timeoutMs}ms.${suffix}`));
				}, timeoutMs);
			}),
		]);
	}
	finally {
		if (timeoutHandle)
			clearRuntimeTimeout(timeoutHandle);
	}
}

function getRuntimeWindow(): (Window & typeof globalThis) | undefined {
	return globalThis.document?.defaultView ?? (typeof window !== 'undefined' ? window : undefined);
}

function scheduleRuntimeTimeout(callback: () => void, delayMs: number): unknown {
	if (typeof eda !== 'undefined' && eda?.sys_Timer && typeof eda.sys_Timer.setTimeoutTimer === 'function')
		return eda.sys_Timer.setTimeoutTimer(callback, delayMs);

	const runtimeWindow = getRuntimeWindow();
	if (runtimeWindow && typeof runtimeWindow.setTimeout === 'function')
		return runtimeWindow.setTimeout.call(runtimeWindow, callback, delayMs);

	return globalThis.setTimeout(callback, delayMs);
}

function clearRuntimeTimeout(timer: unknown): void {
	if (typeof eda !== 'undefined' && eda?.sys_Timer && typeof eda.sys_Timer.clearTimeoutTimer === 'function') {
		eda.sys_Timer.clearTimeoutTimer(timer);
		return;
	}

	const runtimeWindow = getRuntimeWindow();
	if (runtimeWindow && typeof runtimeWindow.clearTimeout === 'function') {
		runtimeWindow.clearTimeout.call(runtimeWindow, timer as number);
		return;
	}

	globalThis.clearTimeout(timer as NodeJS.Timeout);
}
