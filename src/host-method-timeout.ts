export async function withHostMethodTimeout<T>(
	label: string,
	timeoutMs: number,
	operation: () => Promise<T>,
	hint?: string,
): Promise<T> {
	let timeoutHandle: NodeJS.Timeout | undefined;

	try {
		return await Promise.race([
			operation(),
			new Promise<T>((_, reject) => {
				timeoutHandle = setTimeout(() => {
					const suffix = hint ? ` ${hint}` : '';
					reject(new Error(`${label} timed out after ${timeoutMs}ms.${suffix}`));
				}, timeoutMs);
			}),
		]);
	}
	finally {
		if (timeoutHandle)
			clearTimeout(timeoutHandle);
	}
}
