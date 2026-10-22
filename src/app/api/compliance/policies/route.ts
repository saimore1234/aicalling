import { asc } from 'drizzle-orm';
import { db } from '@/db/client';
import { countryPolicies } from '@/db/schema';
import { route } from '@/lib/api';
import { conflict } from '@/lib/errors';
import { policyCreate } from '@/server/compliance-admin';

export const GET = route({ roles: ['ADMIN'] }, async () => ({ policies: await db.select().from(countryPolicies).orderBy(asc(countryPolicies.countryCode)) }));

export const POST = route({ roles: ['ADMIN'], body: policyCreate }, async ({ body, audit }) => {
  const [row] = await db.insert(countryPolicies).values({ ...body, allowedWeekdays: body.allowedWeekdays ?? [1, 2, 3, 4, 5], reviewed: false }).onConflictDoNothing().returning();
  if (!row) throw conflict(`A policy for ${body.countryCode} already exists.`);
  await audit('compliance.policy_created', 'country_policy', row.id, { country: row.countryCode });
  return Response.json({ policy: row }, { status: 201 });
});
