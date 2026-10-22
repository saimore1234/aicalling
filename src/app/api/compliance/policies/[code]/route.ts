import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { countryPolicies } from '@/db/schema';
import { route } from '@/lib/api';
import { badRequest, notFound } from '@/lib/errors';
import { policyPatch } from '@/server/compliance-admin';
import { isValidTimezone } from '@/lib/tz';

export const PATCH = route<{ code: string }, typeof policyPatch>({ roles: ['ADMIN'], body: policyPatch }, async ({ user, params, body, audit }) => {
  const code = params.code.toUpperCase();
  const [p] = await db.select().from(countryPolicies).where(eq(countryPolicies.countryCode, code)).limit(1);
  if (!p) throw notFound('Policy not found');
  if (body.defaultTimezone && !isValidTimezone(body.defaultTimezone)) throw badRequest('Unknown IANA timezone');
  const { reviewed, ...rest } = body;
  const rulesChanged = Object.keys(rest).some((k) => k !== 'notes' && k !== 'name');
  const set: Partial<typeof countryPolicies.$inferInsert> = { ...rest };
  if (reviewed === true) {
    set.reviewed = true; set.reviewedById = user.id; set.reviewedAt = new Date();
  } else if (reviewed === false || rulesChanged) {
    // Any change to the rules voids the previous review: someone must look at the new rules and attest again.
    set.reviewed = false; set.reviewedById = null; set.reviewedAt = null;
  }
  if (rest.requireDndScrub === false) set.dndScrubConfirmedAt = null;
  const [row] = await db.update(countryPolicies).set(set).where(eq(countryPolicies.id, p.id)).returning();
  await audit('compliance.policy_updated', 'country_policy', p.id, { country: code, fields: Object.keys(body), reviewed: row!.reviewed });
  return { policy: row };
});
