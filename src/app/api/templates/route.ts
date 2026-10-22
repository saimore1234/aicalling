import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { messageTemplates } from '@/db/schema';
import { route } from '@/lib/api';
import { emptyToUndefined } from '@/lib/schemas';
import { extractVariables } from '@/server/templates';
import { templateBody } from '@/server/template-input';

const query = z.object({ channel: emptyToUndefined(z.enum(['SMS', 'EMAIL', 'WHATSAPP']).optional()) });

export const GET = route({ query }, async ({ query }) => {
  const rows = await db.select().from(messageTemplates)
    .where(and(isNull(messageTemplates.deletedAt), query.channel ? eq(messageTemplates.channel, query.channel) : undefined))
    .orderBy(asc(messageTemplates.channel), asc(messageTemplates.name));
  return { templates: rows };
});

export const POST = route({ roles: ['ADMIN'], body: templateBody }, async ({ body, audit }) => {
  const variables = extractVariables(body.subject, body.bodyText, body.bodyHtml);
  // New templates are never pre-approved: provider/DLT approval must be attested by an admin separately.
  const [row] = await db.insert(messageTemplates).values({ ...body, variables, approved: false }).returning();
  await audit('template.created', 'template', row!.id, { name: row!.name, channel: row!.channel });
  return Response.json({ template: row }, { status: 201 });
});
