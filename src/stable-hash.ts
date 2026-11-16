/**
 * Deterministic 64-bit FNV-1a hash, hex encoded. This is an identifier, not a
 * security primitive, and it works in Node and Workers without node:crypto.
 */
export function stableHash(value: string): string {
  let low = 0x811c9dc5;
  let high = 0x01000193;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ code, 0x85ebca6b);
  }

  return (
    (low >>> 0).toString(16).padStart(8, "0") +
    (high >>> 0).toString(16).padStart(8, "0")
  );
}
