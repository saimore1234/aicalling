import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customerImports } from '@/db/schema';
import { route } from '@/lib/api';
import { badRequest, conflict, notFound } from '@/lib/errors';
import { enqueueOrThrow } from '@/server/queues';

/**
 * Confirms a previewed import. Importing a phone number does NOT grant permission to call it:
 * consent is only recorded for rows that explicitly carry it, and every call is still gated by the compliance engine.
 */
export const POST = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, audit }) => {
  const [imp] = await db.select().from(customerImports).where(eq(customerImports.id, params.id)).limit(1);
  if (!imp) throw notFound('Import not found');
  if (imp.status !== 'PREVIEW') throw conflict('Only a validated import can be confirmed. Run validation first.');
  if (imp.validRows < 1) throw badRequest('There are no valid rows to import.');

  const res = await db.update(customerImports).set({ status: 'IMPORTING', importedRows: 0 }).where(and(eq(customerImports.id, imp.id), eq(customerImports.status, 'PREVIEW'))).returning({ id: customerImports.id });
  if (!res.length) throw conflict('Import was already confirmed.');
  try {
    await enqueueOrThrow('imports:commit', { importId: imp.id }, { jobId: `import-commit-${imp.id}`, attempts: 1 });
  } catch (err) {
    await db.update(customerImports).set({ status: 'PREVIEW' }).where(eq(customerImports.id, imp.id));
    throw err;
  }
  await audit('customers.import_confirmed', 'customer_import', imp.id, { validRows: imp.validRows });
  return { ok: true };
});
