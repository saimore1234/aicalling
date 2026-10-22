import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customerImports } from '@/db/schema';
import { route } from '@/lib/api';
import { badRequest, conflict, notFound } from '@/lib/errors';
import { channelSchema } from '@/lib/schemas';
import { enqueueOrThrow } from '@/server/queues';
import { validateMapping } from '@/server/imports/validate';

const body = z.object({
  mapping: z.record(z.string().max(200)),
  options: z
    .object({
      defaultCountry: z.string().trim().length(2).toUpperCase().optional(),
      consentChannels: z.array(channelSchema).max(4).optional(),
      defaultConsentSource: z.string().trim().max(200).optional(),
    })
    .default({}),
});

/** Saves the column mapping and queues a dry-run validation (nothing is written to the customers table). */
export const POST = route<{ id: string }, typeof body>({ roles: ['ADMIN'], body }, async ({ params, body, audit }) => {
  const [imp] = await db.select().from(customerImports).where(eq(customerImports.id, params.id)).limit(1);
  if (!imp) throw notFound('Import not found');
  if (!['UPLOADED', 'PREVIEW', 'FAILED'].includes(imp.status)) throw conflict(`Import is ${imp.status.toLowerCase()} and cannot be re-validated.`);

  for (const h of Object.keys(body.mapping)) if (!imp.headers.includes(h)) throw badRequest(`Column "${h}" does not exist in the uploaded file.`);
  const problems = validateMapping(body.mapping);
  if (problems.length) throw badRequest(problems.join(' '), { problems });

  const res = await db
    .update(customerImports)
    .set({ mapping: body.mapping, options: body.options, status: 'VALIDATING', error: null })
    .where(and(eq(customerImports.id, imp.id), inArray(customerImports.status, ['UPLOADED', 'PREVIEW', 'FAILED'])))
    .returning({ id: customerImports.id });
  if (!res.length) throw conflict('Import changed state; refresh and try again.');

  try {
    await enqueueOrThrow('imports:validate', { importId: imp.id }, { jobId: `import-validate-${imp.id}-${Date.now()}`, attempts: 1 });
  } catch (err) {
    await db.update(customerImports).set({ status: imp.status }).where(eq(customerImports.id, imp.id));
    throw err;
  }
  await audit('customers.import_validation_started', 'customer_import', imp.id);
  return { ok: true };
});
