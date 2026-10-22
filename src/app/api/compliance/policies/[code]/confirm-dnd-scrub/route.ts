import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { countryPolicies } from '@/db/schema';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';

const body = z.object({ attest: z.literal(true), note: z.string().max(500).optional() });

/** Admin attests that the call list has been scrubbed against the national do-not-call registry (e.g. India NDNC/DLT preference register). */
export const POST = route<{ code: string }, typeof body>({ roles: ['ADMIN'], body }, async ({ params, body, audit }) => {
  const [row] = await db.update(countryPolicies).set({ dndScrubConfirmedAt: new Date() }).where(eq(countryPolicies.countryCode, params.code.toUpperCase())).returning();
  if (!row) throw notFound('Policy not found');
  await audit('compliance.dnd_scrub_confirmed', 'country_policy', row.id, { country: row.countryCode, note: body.note });
  return { policy: row };
});
