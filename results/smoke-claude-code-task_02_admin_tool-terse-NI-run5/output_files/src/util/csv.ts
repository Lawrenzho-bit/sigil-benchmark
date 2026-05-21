/**
 * CSV helpers for bulk import/export, wrapping the csv-parse / csv-stringify
 * libraries with the options this app expects (header row, trimmed values).
 */
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { badRequest } from '../errors';

/** Parse a CSV string into an array of row objects keyed by header. */
export function parseCsv(input: string): Record<string, string>[] {
  try {
    return parse(input, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as Record<string, string>[];
  } catch (err) {
    throw badRequest('Could not parse CSV: ' + (err as Error).message);
  }
}

/** Serialize an array of row objects to a CSV string with a header row. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return stringify(rows, { header: true, columns });
}
