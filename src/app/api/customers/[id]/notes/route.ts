import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customerNotes, users } from '@/db/schema';
import { route } from '@/lib/api';
import { getScopedCustomer } from '@/server/customers';

export const GET = route<{ id: string }>({}, async ({ user, params }) => {
  const c = await getScopedCustomer(user, params.id);
  const notes = await db
    .select({ id: customerNotes.id, body: customerNotes.body, createdAt: customerNotes.createdAt, authorName: users.name })
    .from(customerNotes)
    .leftJoin(users, eq(users.id, customerNotes.authorId))
    .where(eq(customerNotes.customerId, c.id))
    .orderBy(desc(customerNotes.createdAt));
  return { notes };
});

const body = z.object({ body: z.string().trim().min(1).max(4000) });

export const POST = route<{ id: string }, typeof body>({ body }, async ({ user, params, body, audit }) => {
  const c = await getScopedCustomer(user, params.id);
  const [n] = await db.insert(customerNotes).values({ customerId: c.id, authorId: user.id, body: body.body }).returning();
  await audit('customer.note_added', 'customer', c.id);
  return Response.json({ note: n }, { status: 201 });
});
