import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { consentRecords, customers } from '@/db/schema';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { channelSchema } from '@/lib/schemas';
import { getScopedCustomer, requireAdmin } from '@/server/customers';

const body = z.object({
  channel: channelSchema,
  status: z.enum(['GRANTED', 'DENIED', 'WITHDRAWN']),
  source: z.string().trim().min(1, 'A consent source is required (e.g. web form, signed agreement)').max(200),
  evidence: z.string().trim().max(1000).optional(),
  capturedAt: z.string().datetime().optional(),
});

/** Append-only consent ledger. Records are never edited; a new record supersedes the previous state. */
export const POST = route<{ id: string }, typeof body>({ body }, async ({ user, params, body, audit }) => {
  requireAdmin(user);
  const c = await getScopedCustomer(user, params.id);
  const at = body.capturedAt ? new Date(body.capturedAt) : new Date();
  if (at.getTime() > Date.now() + 5 * 60_000) throw badRequest('Consent date cannot be in the future');
  const [rec] = await db
    .insert(consentRecords)
    .values({ customerId: c.id, channel: body.channel, status: body.status, source: body.source, evidence: body.evidence ?? null, capturedAt: at, recordedById: user.id })
    .returning();
  // Re-granting voice consent does not clear an explicit DNC flag; that requires lifting the suppression record.
  await db.update(customers).set({ updatedAt: new Date() }).where(eq(customers.id, c.id));
  await audit('consent.recorded', 'customer', c.id, { channel: body.channel, status: body.status, source: body.source });
  return Response.json({ consent: rec }, { status: 201 });
});
