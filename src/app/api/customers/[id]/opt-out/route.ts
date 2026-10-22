import { z } from 'zod';
import { route } from '@/lib/api';
import { channelSchema } from '@/lib/schemas';
import { applyOptOut } from '@/server/compliance';
import { getScopedCustomer } from '@/server/customers';

const body = z.object({ channels: z.union([z.literal('ALL'), z.array(channelSchema).min(1)]).default('ALL'), note: z.string().trim().max(500).optional() });

/** Immediate opt-out (e.g. a sales exec takes a "stop calling me" request). Takes effect before this request returns. */
export const POST = route<{ id: string }, typeof body>({ body }, async ({ user, params, body }) => {
  const c = await getScopedCustomer(user, params.id);
  await applyOptOut({ customerId: c.id, channels: body.channels, source: 'manual_by_user', note: body.note, userId: user.id });
  return { ok: true };
});
