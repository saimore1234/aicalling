import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { aiAgents } from '@/db/schema';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { buildInstructions, renderGreeting } from '@/voice/prompt';

/** Shows exactly what the real-time model will be told, using a sample customer. */
export const GET = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params }) => {
  const [a] = await db.select().from(aiAgents).where(eq(aiAgents.id, params.id)).limit(1);
  if (!a) throw notFound('Agent not found');
  const sample = { name: 'Asha Verma', company: 'Sample Traders', productInterest: 'Sample product' };
  return { greeting: renderGreeting(a, sample), instructions: buildInstructions(a, sample, { transferAvailable: !!a.humanTransferNumber }) };
});
