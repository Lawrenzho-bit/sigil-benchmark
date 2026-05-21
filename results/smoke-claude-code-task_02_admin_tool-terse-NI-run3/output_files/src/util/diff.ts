/**
 * Computes a field-level diff between two records, restricted to a set of
 * tracked fields. Used to give every audit-log entry a precise before/after.
 */
export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

export function computeDiff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: readonly (keyof T)[],
): FieldDiff {
  const diff: FieldDiff = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = before[field];
    const to = after[field];
    if (!Object.is(normalize(from), normalize(to))) {
      diff[String(field)] = { from, to };
    }
  }
  return diff;
}

/** Dates compare by ISO string so equal instants don't show as changes. */
function normalize(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

export function isEmptyDiff(diff: FieldDiff): boolean {
  return Object.keys(diff).length === 0;
}
