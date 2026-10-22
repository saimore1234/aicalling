import { and, count, desc, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { calls, consentRecords, customers, leadQualifications, messages, pipelineStages, suppressionRecords, users } from '@/db/schema';
import { route } from '@/lib/api';
import { badRequest, conflict, forbidden } from '@/lib/errors';
import { customerInput, normalizeCustomerInput } from '@/server/customer-input';
import { getScopedCustomer, latestConsentByChannel } from '@/server/customers';

export const GET = route<{ id: string }>({}, async ({ user, params }) => {
  const c = await getScopedCustomer(user, params.id);
  const [owner] = c.ownerId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, c.ownerId)) : [];
  const [stage] = c.stageId ? await db.select().from(pipelineStages).where(eq(pipelineStages.id, c.stageId)) : [];
  const [qual] = await db.select().from(leadQualifications).where(eq(leadQualifications.customerId, c.id)).orderBy(desc(leadQualifications.createdAt)).limit(1);
  const [callCount] = await db.select({ n: count() }).from(calls).where(eq(calls.customerId, c.id));
  const [msgCount] = await db.select({ n: count() }).from(messages).where(eq(messages.customerId, c.id));
  const consentHistory = await db.select().from(consentRecords).where(eq(consentRecords.customerId, c.id)).orderBy(desc(consentRecords.capturedAt), desc(consentRecords.createdAt)).limit(100);
  const suppressions = await db.select().from(suppressionRecords).where(eq(suppressionRecords.customerId, c.id)).orderBy(desc(suppressionRecords.createdAt));
  return {
    customer: c,
    owner: owner ?? null,
    stage: stage ?? null,
    qualification: qual ?? null,
    consent: await latestConsentByChannel(c.id),
    consentHistory,
    suppressions,
    counts: { calls: Number(callCount?.n ?? 0), messages: Number(msgCount?.n ?? 0) },
  };
});

const patchBody = customerInput.partial().extend({
  stageId: z.string().uuid().optional(),
  leadScore: z.number().int().min(0).max(100).nullable().optional(),
  leadScoreReason: z.string().max(1000).nullable().optional(),
});

export const PATCH = route<{ id: string }, typeof patchBody>({ body: patchBody }, async ({ user, params, body, audit }) => {
  const c = await getScopedCustomer(user, params.id);
  const patch: Partial<typeof customers.$inferInsert> = {};

  if (user.role !== 'ADMIN') {
    // Sales executives may move their own leads through the pipeline; everything else is admin-only.
    const keys = Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined);
    if (keys.some((k) => k !== 'stageId')) throw forbidden('Sales executives can only change the pipeline stage');
  }
  if (body.stageId) {
    const [s] = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(eq(pipelineStages.id, body.stageId)).limit(1);
    if (!s) throw badRequest('Unknown pipeline stage');
    patch.stageId = body.stageId;
  }
  if (user.role === 'ADMIN') {
    const merged = {
      name: body.name ?? c.name,
      company: body.company === undefined ? c.company : body.company,
      phone: body.phone === undefined ? c.phone : body.phone,
      email: body.email === undefined ? c.email : body.email,
      country: body.country === undefined ? c.country : body.country,
      timezone: body.timezone === undefined ? c.timezone : body.timezone,
      language: body.language === undefined ? c.language : body.language,
      productInterest: body.productInterest === undefined ? c.productInterest : body.productInterest,
      category: body.category === undefined ? c.category : body.category,
      leadSource: body.leadSource === undefined ? c.leadSource : body.leadSource,
      notes: body.notes === undefined ? c.notes : body.notes,
      customFields: body.customFields ?? c.customFields,
    };
    const r = normalizeCustomerInput(merged);
    if (r.phone && r.phone !== c.phone) {
      const [dupe] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.phone, r.phone), isNull(customers.deletedAt), ne(customers.id, c.id))).limit(1);
      if (dupe) throw conflict('Another customer already has this phone number', { existingId: dupe.id });
    }
    Object.assign(patch, {
      name: r.name,
      company: r.company,
      phone: r.phone,
      phoneRaw: r.phone === c.phone ? c.phoneRaw : r.phoneRaw,
      email: r.email,
      country: r.country,
      timezone: r.timezone,
      language: r.language,
      productInterest: r.productInterest,
      category: r.category,
      leadSource: r.leadSource,
      notes: r.notes,
      customFields: r.customFields,
    });
    if (body.ownerId !== undefined) patch.ownerId = body.ownerId;
    if (body.leadScore !== undefined) patch.leadScore = body.leadScore;
    if (body.leadScoreReason !== undefined) patch.leadScoreReason = body.leadScoreReason;
  }
  const [updated] = await db.update(customers).set(patch).where(eq(customers.id, c.id)).returning();
  await audit('customer.updated', 'customer', c.id, { fields: Object.keys(patch) });
  return { customer: updated };
});

export const DELETE = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, user, audit }) => {
  const c = await getScopedCustomer(user, params.id);
  // Soft delete: the phone number is released for re-import, but suppression records keyed on the
  // number/email remain, so a deleted opt-out can never be re-contacted by re-importing the same number.
  await db.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, c.id));
  await audit('customer.deleted', 'customer', c.id);
  return { ok: true };
});
