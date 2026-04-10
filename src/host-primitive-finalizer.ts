interface MaybeDonePrimitive {
	done?: () => Promise<unknown> | unknown;
}

function getFinalizablePrimitive(value: unknown): MaybeDonePrimitive | undefined {
	if (Array.isArray(value))
		return value.length === 1 ? getFinalizablePrimitive(value[0]) : undefined;

	return value && typeof value === 'object' ? value as MaybeDonePrimitive : undefined;
}

export async function finalizeHostPrimitive<T>(primitive: T): Promise<T> {
	const finalizablePrimitive = getFinalizablePrimitive(primitive);
	if (typeof finalizablePrimitive?.done !== 'function')
		return primitive;

	const finalizedPrimitive = await finalizablePrimitive.done();
	return (finalizedPrimitive ?? primitive) as T;
}
