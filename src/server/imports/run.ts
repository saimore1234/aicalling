import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';
import { db } from '@/db/client';
import {
  consentRecords,
  customerImports,
  customers,
  importRowErrors,
  pipelineStages,
  suppressionRecords,
  users,
} from '@/db/schema';
import { audit } from '@/lib/audit';
import { logger, sanitizeError } from '@/lib/logger';
import { readRows, safeUploadPath, type RawRow } from './reader';
import { validateRow, type ImportOptions, type ValidRecord } from './validate';

const CHUNK = 500;
const PREVIEW_ROWS = 50;

type Classified = {
  valid: { rowNumber: number; record: ValidRecord; ownerId: string | null; raw: Record<string, string> }[];
  errors: { rowNumber: number; kind: 'INVALID' | 'DUPLICATE_IN_FILE' | 'DUPLICATE_EXISTING'; raw: Record<string, string>; errors: string[] }[];
};

async function loadOwners() {
  const rows = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(and(isNull(users.deletedAt), eq(users.active, true)));
  const map = new Map<string, string>();
  for (const u of rows) {
    map.set(u.email.toLowerCase(), u.id);
    map.set(u.name.toLowerCase(), u.id);
  }
  return map;
}

/** Streams the file in chunks, classifying each row as valid / invalid / duplicate. */
async function* classifyFile(imp: typeof customerImports.$inferSelect): AsyncGenerator<Classified & { processed: number }> {
  const owners = await loadOwners();
  const options = imp.options as ImportOptions;
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  let buffer: RawRow[] = [];
  let processed = 0;

  const flush = async (rows: RawRow[]): Promise<Classified> => {
    const out: Classified = { valid: [], errors: [] };
    const candidates: Classified['valid'] = [];
    for (const row of rows) {
      const res = validateRow(row.data, imp.mapping, options);
      if (!res.ok) {
        out.errors.push({ rowNumber: row.rowNumber, kind: 'INVALID', raw: row.data, errors: res.errors });
        continue;
      }
      let ownerId: string | null = null;
      if (res.record.salesOwnerRef) {
        ownerId = owners.get(res.record.salesOwnerRef) ?? null;
        if (!ownerId) {
          out.errors.push({ rowNumber: row.rowNumber, kind: 'INVALID', raw: row.data, errors: [`Sales owner "${res.record.salesOwnerRef}" does not match any active user.`] });
          continue;
        }
      }
      const { phone, email } = res.record;
      const key = phone ? `p:${phone}` : `e:${email}`;
      const dupInFile = phone ? seenPhones.has(phone) : !!email && seenEmails.has(email);
      if (dupInFile) {
        out.errors.push({ rowNumber: row.rowNumber, kind: 'DUPLICATE_IN_FILE', raw: row.data, errors: [`Duplicate of an earlier row in this file (${key.slice(2)}).`] });
        continue;
      }
      if (phone) seenPhones.add(phone);
      if (email) seenEmails.add(email);
      candidates.push({ rowNumber: row.rowNumber, record: res.record, ownerId, raw: row.data });
    }

    // Duplicates against customers that already exist (soft-deleted ones don't count).
    const phones = candidates.map((c) => c.record.phone).filter((p): p is string => !!p);
    const emailsNoPhone = candidates.filter((c) => !c.record.phone).map((c) => c.record.email!).filter(Boolean);
    const existingPhones = new Set<string>();
    const existingEmails = new Set<string>();
    if (phones.length) {
      const rows = await db.select({ phone: customers.phone }).from(customers).where(and(inArray(customers.phone, phones), isNull(customers.deletedAt)));
      rows.forEach((r) => r.phone && existingPhones.add(r.phone));
    }
    if (emailsNoPhone.length) {
      const rows = await db.select({ email: customers.email }).from(customers).where(and(inArray(customers.email, emailsNoPhone), isNull(customers.deletedAt)));
      rows.forEach((r) => r.email && existingEmails.add(r.email));
    }
    for (const c of candidates) {
      const dup = c.record.phone ? existingPhones.has(c.record.phone) : !!c.record.email && existingEmails.has(c.record.email);
      if (dup) {
        out.errors.push({
          rowNumber: c.rowNumber,
          kind: 'DUPLICATE_EXISTING',
          raw: c.raw,
          errors: [`A customer with this ${c.record.phone ? 'phone number' : 'email address'} already exists.`],
        });
      } else out.valid.push(c);
    }
    return out;
  };

  for await (const row of readRows(safeUploadPath(imp.storedName), imp.fileType as 'csv' | 'xlsx')) {
    buffer.push(row);
    processed++;
    if (buffer.length >= CHUNK) {
      yield { ...(await flush(buffer)), processed };
      buffer = [];
    }
  }
  if (buffer.length) yield { ...(await flush(buffer)), processed };
}

export async function runValidate(importId: string) {
  const [imp] = await db.select().from(customerImports).where(eq(customerImports.id, importId)).limit(1);
  if (!imp) throw new Error('Import not found');
  if (imp.status === 'IMPORTING' || imp.status === 'COMPLETED') return; // never re-validate a committed import

  await db.update(customerImports).set({ status: 'VALIDATING', error: null, totalRows: 0, validRows: 0, invalidRows: 0, duplicateRows: 0, preview: [] }).where(eq(customerImports.id, importId));
  await db.delete(importRowErrors).where(eq(importRowErrors.importId, importId));

  let total = 0;
  let valid = 0;
  let invalid = 0;
  let dupes = 0;
  const preview: Record<string, unknown>[] = [];
  try {
    for await (const chunk of classifyFile(imp)) {
      total = chunk.processed;
      valid += chunk.valid.length;
      for (const v of chunk.valid) {
        if (preview.length < PREVIEW_ROWS) {
          const { salesOwnerRef: _o, ...rest } = v.record;
          preview.push({ rowNumber: v.rowNumber, ...rest, consentAt: v.record.consentAt?.toISOString() ?? null });
        }
      }
      if (chunk.errors.length) {
        for (const e of chunk.errors) { if (e.kind === 'INVALID') invalid++; else dupes++; }
        await db.insert(importRowErrors).values(chunk.errors.map((e) => ({ importId, rowNumber: e.rowNumber, kind: e.kind, rawData: e.raw, errors: e.errors })));
      }
      await db.update(customerImports).set({ totalRows: total, validRows: valid, invalidRows: invalid, duplicateRows: dupes }).where(eq(customerImports.id, importId));
    }
    await db.update(customerImports).set({ status: 'PREVIEW', totalRows: total, validRows: valid, invalidRows: invalid, duplicateRows: dupes, preview }).where(eq(customerImports.id, importId));
  } catch (err) {
    logger.error({ importId, err: sanitizeError(err) }, 'import validation failed');
    await db.update(customerImports).set({ status: 'FAILED', error: sanitizeError(err) }).where(eq(customerImports.id, importId));
    throw err;
  }
}

export async function runCommit(importId: string) {
  const [imp] = await db.select().from(customerImports).where(eq(customerImports.id, importId)).limit(1);
  if (!imp) throw new Error('Import not found');
  if (imp.status === 'COMPLETED') return;
  if (imp.status !== 'IMPORTING') throw new Error(`Import is ${imp.status}; it must be confirmed from the preview step first.`);

  const options = imp.options as ImportOptions;
  const consentChannels = (options.consentChannels?.length ? options.consentChannels : ['VOICE']) as ('VOICE' | 'SMS' | 'EMAIL' | 'WHATSAPP')[];
  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.key, 'new')).limit(1);
  await db.delete(importRowErrors).where(eq(importRowErrors.importId, importId));

  let imported = 0;
  let invalid = 0;
  let dupes = 0;
  let total = 0;
  try {
    for await (const chunk of classifyFile(imp)) {
      total = chunk.processed;
      for (const e of chunk.errors) { if (e.kind === 'INVALID') invalid++; else dupes++; }
      if (chunk.errors.length) {
        await db.insert(importRowErrors).values(chunk.errors.map((e) => ({ importId, rowNumber: e.rowNumber, kind: e.kind, rawData: e.raw, errors: e.errors })));
      }

      const insertOne = async (v: Classified['valid'][number]): Promise<boolean> => {
        try {
          await db.transaction(async (tx) => {
            const r = v.record;
            const [c] = await tx
              .insert(customers)
              .values({
                name: r.name,
                company: r.company,
                phone: r.phone,
                phoneRaw: r.phoneRaw,
                email: r.email,
                country: r.country,
                timezone: r.timezone,
                language: r.language,
                productInterest: r.productInterest,
                category: r.category,
                leadSource: r.leadSource,
                ownerId: v.ownerId,
                stageId: stage?.id ?? null,
                notes: r.notes,
                customFields: r.customFields,
                doNotCall: r.doNotCall,
                importId,
              })
              .returning({ id: customers.id });
            if (r.consentStatus !== 'UNKNOWN') {
              await tx.insert(consentRecords).values(
                consentChannels.map((ch) => ({
                  customerId: c!.id,
                  channel: ch,
                  status: r.consentStatus,
                  source: r.consentSource ?? `import:${imp.fileName}`,
                  evidence: r.consentAt ? `Consent date supplied in import "${imp.fileName}".` : `Imported from "${imp.fileName}"; consent date not supplied (captured at import time).`,
                  capturedAt: r.consentAt ?? new Date(),
                })),
              );
            }
            if (r.doNotCall) {
              await tx.insert(suppressionRecords).values({ channel: null, phone: r.phone, email: r.email, customerId: c!.id, reason: 'DNC_REGISTRY', source: `import:${imp.fileName}`, note: 'Flagged do-not-call in import file' });
            }
          });
          return true;
        } catch (err) {
          if ((err as { code?: string }).code === '23505') return false; // lost a race with another insert → duplicate
          throw err;
        }
      };

      for (const v of chunk.valid) {
        if (await insertOne(v)) imported++;
        else {
          dupes++;
          await db.insert(importRowErrors).values({ importId, rowNumber: v.rowNumber, kind: 'DUPLICATE_EXISTING', rawData: v.raw, errors: ['A customer with this phone number or email was created while the import was running.'] });
        }
      }
      await db.update(customerImports).set({ importedRows: imported, totalRows: total, invalidRows: invalid, duplicateRows: dupes }).where(eq(customerImports.id, importId));
    }
    await db
      .update(customerImports)
      .set({ status: 'COMPLETED', importedRows: imported, totalRows: total, invalidRows: invalid, duplicateRows: dupes, validRows: imported, completedAt: new Date() })
      .where(eq(customerImports.id, importId));
    await audit({ userId: imp.createdById, action: 'customers.import_completed', entityType: 'customer_import', entityId: importId, metadata: { imported, invalid, duplicates: dupes, file: imp.fileName } });
  } catch (err) {
    logger.error({ importId, err: sanitizeError(err) }, 'import commit failed');
    await db.update(customerImports).set({ status: 'FAILED', error: sanitizeError(err), importedRows: imported }).where(eq(customerImports.id, importId));
    throw err;
  }
}

/** CSV of every row that was not imported, with the reason, for the admin to fix and re-upload. */
export async function failedRowsCsv(importId: string): Promise<string> {
  const rows = await db.select().from(importRowErrors).where(eq(importRowErrors.importId, importId)).orderBy(asc(importRowErrors.rowNumber));
  const headers = new Set<string>();
  rows.forEach((r) => Object.keys(r.rawData).forEach((h) => headers.add(h)));
  const cols = ['row_number', 'problem_type', 'reason', ...headers];
  const records = rows.map((r) => [r.rowNumber, r.kind, r.errors.join(' | '), ...[...headers].map((h) => csvSafe(r.rawData[h] ?? ''))]);
  return stringify([cols, ...records]);
}

/**
 * Neutralise spreadsheet formula injection when the report is opened in Excel. Phone-like values
 * (e.g. "+91 98765 43210", "-" separators) are left intact so the report can be fixed and re-uploaded.
 */
export function csvSafe(v: string): string {
  if (/^[=@\t\r]/.test(v)) return `'${v}`;
  if (/^[+-]/.test(v) && !/^[+-][\d\s().-]*$/.test(v)) return `'${v}`;
  return v;
}
