/**
 * Shallow before/after diffing for audit entries. Produces a compact map of
 * only the fields that actually changed.
 */
export type FieldDiff = Record<string, { before: unknown; after: unknown }>;

const isEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

/**
 * Compute changed fields between two records. Only keys present in `fields`
 * (or, if omitted, the union of both objects' keys) are considered.
 */
export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields?: string[],
): FieldDiff {
  const keys = fields ?? Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const diff: FieldDiff = {};
  for (const key of keys) {
    if (!isEqual(before[key], after[key])) {
      diff[key] = { before: before[key] ?? null, after: after[key] ?? null };
    }
  }
  return diff;
}

export function hasChanges(diff: FieldDiff): boolean {
  return Object.keys(diff).length > 0;
}
