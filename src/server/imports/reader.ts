import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse';
import { getEnv } from '@/lib/env';

export const MAX_IMPORT_ROWS = 100_000;
export type RawRow = { rowNumber: number; data: Record<string, string> };

export function uploadRoot(): string {
  return path.resolve(getEnv().UPLOAD_DIR);
}

/** Resolve a stored file name inside the upload dir; refuses anything that escapes it (path traversal guard). */
export function safeUploadPath(storedName: string): string {
  const base = path.basename(storedName);
  if (base !== storedName || !/^[a-f0-9-]{36}\.(csv|xlsx)$/.test(base)) throw new Error('Invalid stored file name');
  const full = path.resolve(uploadRoot(), 'imports', base);
  if (!full.startsWith(path.resolve(uploadRoot(), 'imports') + path.sep)) throw new Error('Path escapes upload directory');
  return full;
}

export function detectFileType(buf: Buffer, fileName: string): 'csv' | 'xlsx' | null {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.xlsx') return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04 ? 'xlsx' : null;
  if (ext === '.csv') {
    const head = buf.subarray(0, 4096);
    if (head.includes(0)) return null; // binary content disguised as CSV
    return 'csv';
  }
  return null;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('').trim();
    if (o.result !== undefined) return cellToString(o.result);
    if (o.text !== undefined) return cellToString(o.text);
    return '';
  }
  return String(v).trim();
}

function detectDelimiter(headerLine: string): string {
  const counts = [',', ';', '\t', '|'].map((d) => [d, headerLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}

async function* readCsv(file: string): AsyncGenerator<string[]> {
  const fd = fs.openSync(file, 'r');
  const probe = Buffer.alloc(8192);
  const n = fs.readSync(fd, probe, 0, probe.length, 0);
  fs.closeSync(fd);
  const firstLine = probe.subarray(0, n).toString('utf8').replace(/^﻿/, '').split(/\r?\n/)[0] ?? '';
  const parser = fs.createReadStream(file).pipe(
    parse({ delimiter: detectDelimiter(firstLine), bom: true, skip_empty_lines: true, relax_column_count: true, trim: true, relax_quotes: true }),
  );
  for await (const record of parser) yield record as string[];
}

async function* readXlsx(file: string): AsyncGenerator<string[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'cache', worksheets: 'emit' });
  for await (const ws of reader) {
    // Only the first worksheet is imported.
    for await (const row of ws) {
      const values = (row.values as unknown[]).slice(1);
      yield values.map(cellToString);
    }
    return;
  }
}

/** Streams data rows as objects keyed by header. rowNumber is the 1-based spreadsheet row (header = row 1). */
export async function* readRows(file: string, type: 'csv' | 'xlsx'): AsyncGenerator<RawRow> {
  const source = type === 'csv' ? readCsv(file) : readXlsx(file);
  let headers: string[] | null = null;
  let rowNumber = 0;
  let count = 0;
  for await (const cells of source) {
    rowNumber++;
    if (!headers) {
      headers = cells.map((h, i) => (String(h ?? '').trim() || `Column ${i + 1}`));
      // De-duplicate header names so mapping keys are unique.
      const seen = new Map<string, number>();
      headers = headers.map((h) => {
        const k = h.toLowerCase();
        const n = (seen.get(k) ?? 0) + 1;
        seen.set(k, n);
        return n > 1 ? `${h} (${n})` : h;
      });
      continue;
    }
    if (cells.every((c) => !String(c ?? '').trim())) continue;
    if (++count > MAX_IMPORT_ROWS) throw new Error(`File has more than ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split it into smaller files.`);
    const data: Record<string, string> = {};
    headers.forEach((h, i) => (data[h] = String(cells[i] ?? '').trim()));
    yield { rowNumber, data };
  }
}

/** Header names plus the first few rows, for the mapping step. Reads only what it needs. */
export async function sniffFile(file: string, type: 'csv' | 'xlsx', sampleSize = 5) {
  const sample: Record<string, string>[] = [];
  let headers: string[] = [];
  for await (const row of readRows(file, type)) {
    if (!headers.length) headers = Object.keys(row.data);
    sample.push(row.data);
    if (sample.length >= sampleSize) break;
  }
  if (!headers.length) {
    // Header-only or empty file: read the header alone.
    const source = type === 'csv' ? readCsv(file) : readXlsx(file);
    for await (const cells of source) {
      headers = cells.map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`);
      break;
    }
  }
  return { headers, sample };
}
