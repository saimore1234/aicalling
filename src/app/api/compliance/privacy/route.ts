import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  appointments, calls, consentRecords, customerNotes, customers, followUpTasks, leadQualifications, messages, privacyRequests, suppressionRecords, transcripts,
} from '@/db/schema';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';

const body = z.object({ customerId: z.string().uuid(), type: z.enum(['EXPORT', 'ERASE']), confirm: z.string().optional(), notes: z.string().max(500).optional() });

export const GET = route({ roles: ['ADMIN'] }, async () => ({
  requests: await db.select().from(privacyRequests).orderBy(sql`${privacyRequests.createdAt} desc`).limit(200),
}));

/**
 * Data-subject requests.
 *  EXPORT: returns everything held about the customer as JSON.
 *  ERASE : removes personal data (profile, notes, transcripts, message bodies, qualification text) but KEEPS a
 *          suppression record for the phone/email so the person is never contacted again or re-imported and called.
 */
export const POST = route<Record<string, string>, typeof body>({ roles: ['ADMIN'], body, rateLimit: { name: 'privacy', limit: 20, windowSec: 60, by: 'user' } }, async ({ user, body, audit }) => {
  const [c] = await db.select().from(customers).where(eq(customers.id, body.customerId)).limit(1);
  if (!c) throw notFound('Customer not found');

  if (body.type === 'EXPORT') {
    const data = {
      exportedAt: new Date().toISOString(),
      customer: c,
      notes: await db.select().from(customerNotes).where(eq(customerNotes.customerId, c.id)),
      consent: await db.select().from(consentRecords).where(eq(consentRecords.customerId, c.id)),
      suppression: await db.select().from(suppressionRecords).where(eq(suppressionRecords.customerId, c.id)),
      calls: await db.select().from(calls).where(eq(calls.customerId, c.id)),
      transcripts: await db.select({ t: transcripts }).from(transcripts).innerJoin(calls, eq(calls.id, transcripts.callId)).where(eq(calls.customerId, c.id)).then((r) => r.map((x) => x.t)),
      qualifications: await db.select().from(leadQualifications).where(eq(leadQualifications.customerId, c.id)),
      messages: await db.select().from(messages).where(eq(messages.customerId, c.id)),
      appointments: await db.select().from(appointments).where(eq(appointments.customerId, c.id)),
    };
    await db.insert(privacyRequests).values({ customerId: c.id, customerRef: c.name, type: 'EXPORT', requestedById: user.id, notes: body.notes ?? null, completedAt: new Date() });
    await audit('privacy.export', 'customer', c.id);
    return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="export-${c.id}.json"` } });
  }

  if (body.confirm !== 'ERASE') {
    return Response.json({ error: 'Type ERASE to confirm. This permanently removes personal data and cannot be undone.', code: 'confirmation_required' }, { status: 400 });
  }
  await db.transaction(async (tx) => {
    if (c.phone || c.email) {
      await tx.insert(suppressionRecords).values({ phone: c.phone, email: c.email, customerId: null, channel: null, reason: 'PRIVACY_REQUEST', source: 'erasure', note: 'Retained so the person is not contacted again', createdById: user.id });
    }
    const callIds = (await tx.select({ id: calls.id }).from(calls).where(eq(calls.customerId, c.id))).map((x) => x.id);
    for (const id of callIds) await tx.delete(transcripts).where(eq(transcripts.callId, id));
    await tx.update(calls).set({ summary: null, toNumber: 'erased' }).where(eq(calls.customerId, c.id));
    await tx.update(leadQualifications).set({ reason: 'erased', evidence: [], nextStep: null, meetingPreference: null, rawOutput: null }).where(eq(leadQualifications.customerId, c.id));
    await tx.update(messages).set({ body: 'erased', subject: null, toAddress: 'erased', fromAddress: null }).where(eq(messages.customerId, c.id));
    await tx.delete(customerNotes).where(eq(customerNotes.customerId, c.id));
    await tx.update(followUpTasks).set({ status: 'CANCELED', payload: {} }).where(eq(followUpTasks.customerId, c.id));
    await tx.update(appointments).set({ notes: null, location: null, requestedWindow: null, status: 'CANCELED' }).where(eq(appointments.customerId, c.id));
    await tx.update(customers).set({
      name: 'Erased customer', company: null, phone: null, phoneRaw: null, email: `erased-${c.id}@erased.invalid`, notes: null, customFields: {}, productInterest: null, category: null, leadSource: null,
      leadScoreReason: null, doNotCall: true, deletedAt: new Date(),
    }).where(eq(customers.id, c.id));
    await tx.insert(privacyRequests).values({ customerId: c.id, customerRef: 'erased', type: 'ERASE', requestedById: user.id, notes: body.notes ?? null, completedAt: new Date() });
  });
  await audit('privacy.erase', 'customer', c.id);
  return { ok: true };
});
