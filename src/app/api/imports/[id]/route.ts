import fs from 'node:fs/promises';
import { asc, count, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customerImports, importRowErrors } from '@/db/schema';
import { route } from '@/lib/api';
import { conflict, notFound } from '@/lib/errors';
import { safeUploadPath } from '@/server/imports/reader';

export const GET = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params }) => {
  const [imp] = await db.select().from(customerImports).where(eq(customerImports.id, params.id)).limit(1);
  if (!imp) throw notFound('Import not found');
  const [{ n }] = await db.select({ n: count() }).from(importRowErrors).where(eq(importRowErrors.importId, imp.id));
  const errorSample = await db.select().from(importRowErrors).where(eq(importRowErrors.importId, imp.id)).orderBy(asc(importRowErrors.rowNumber)).limit(50);
  const { storedName: _s, ...safe } = imp; // never expose server file names
  return { import: safe, errorCount: Number(n), errorSample };
});

export const DELETE = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, audit }) => {
  const [imp] = await db.select().from(customerImports).where(eq(customerImports.id, params.id)).limit(1);
  if (!imp) throw notFound('Import not found');
  if (imp.status === 'VALIDATING' || imp.status === 'IMPORTING') throw conflict('This import is currently being processed.');
  await fs.rm(safeUploadPath(imp.storedName), { force: true });
  await db.delete(customerImports).where(eq(customerImports.id, imp.id));
  await audit('customers.import_deleted', 'customer_import', imp.id);
  return { ok: true };
});
