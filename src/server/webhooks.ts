import { db } from '@/db/client';
import { webhookReceipts } from '@/db/schema';

/**
 * Replay / duplicate protection. Returns true the FIRST time an (provider, eventKey) pair is seen,
 * false for retries. Backed by a unique index so it is safe under concurrent deliveries.
 */
export async function claimWebhookEvent(provider: string, eventKey: string): Promise<boolean> {
  const rows = await db.insert(webhookReceipts).values({ provider, eventKey }).onConflictDoNothing().returning({ id: webhookReceipts.id });
  return rows.length > 0;
}
