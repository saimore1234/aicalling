import { db, type Tx } from '@/db/client';
import { auditLogs } from '@/db/schema';
import { logger } from './logger';

export type AuditInput = {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

const SENSITIVE = /password|token|secret|apikey|authorization/i;

function scrub(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SENSITIVE.test(k) ? '[REDACTED]' : v;
  return out;
}

export async function audit(input: AuditInput, tx?: Tx) {
  try {
    await (tx ?? db).insert(auditLogs).values({
      userId: input.userId ?? null,
      userEmail: input.userEmail ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: scrub(input.metadata),
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    });
  } catch (err) {
    // Audit failures must be visible to operators but must not crash the primary action.
    logger.error({ err: (err as Error).message, action: input.action }, 'audit log write failed');
  }
}
