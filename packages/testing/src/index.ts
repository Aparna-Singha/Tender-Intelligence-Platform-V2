export function unreachable(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
