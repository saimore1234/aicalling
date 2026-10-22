import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { pipelineStages } from '@/db/schema';
import { route } from '@/lib/api';
import { conflict } from '@/lib/errors';

export const GET = route({}, async () => ({ stages: await db.select().from(pipelineStages).orderBy(asc(pipelineStages.position)) }));

const create = z.object({ name: z.string().trim().min(1).max(60), isWon: z.boolean().default(false), isLost: z.boolean().default(false) });

export const POST = route({ roles: ['ADMIN'], body: create }, async ({ body, audit }) => {
  const key = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const [dupe] = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(eq(pipelineStages.key, key)).limit(1);
  if (dupe) throw conflict('A stage with that name already exists');
  const all = await db.select({ p: pipelineStages.position }).from(pipelineStages);
  const [s] = await db.insert(pipelineStages).values({ key, name: body.name, position: Math.max(0, ...all.map((a) => a.p)) + 1, isWon: body.isWon, isLost: body.isLost }).returning();
  await audit('pipeline.stage_created', 'pipeline_stage', s!.id);
  return Response.json({ stage: s }, { status: 201 });
});

const reorder = z.object({ order: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(1).max(100), name: z.string().trim().min(1).max(60).optional(), active: z.boolean().optional() })).min(1) });

export const PATCH = route({ roles: ['ADMIN'], body: reorder }, async ({ body, audit }) => {
  await db.transaction(async (tx) => {
    for (const o of body.order) await tx.update(pipelineStages).set({ position: o.position, ...(o.name ? { name: o.name } : {}), ...(o.active !== undefined ? { active: o.active } : {}) }).where(eq(pipelineStages.id, o.id));
  });
  await audit('pipeline.stages_updated', 'pipeline_stage', null, { count: body.order.length });
  return { ok: true };
});
