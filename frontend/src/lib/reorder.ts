export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  const result = [...items];
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length ||
    from === to
  ) {
    return result;
  }
  const [moved] = result.splice(from, 1);
  result.splice(to, 0, moved);
  return result;
}
