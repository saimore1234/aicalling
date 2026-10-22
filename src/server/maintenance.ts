import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  backgroundJobs, calls, campaignLeads, customerImports, followUpTasks, passwordResetTokens, sessions, transcripts, webhookReceipts, auditLogs,
} from '@/db/schema';
import { logger, sanitizeError } from '@/lib/logger';
import { getAppSettings } from '@/lib/settings';
import { getTelephonyProvider } from '@/providers';
import { ACTIVE, applyCallStatus, mapProviderStatus } from './calls';

const min = (n: number) => new Date(Date.now() - n * 60_000);

/** Heals work that was interrupted by a crash or lost job: stuck calls, leads, imports and follow-ups. */
export async function runReaper() {
  const result = { calls: 0, leads: 0, imports: 0, followUps: 0 };
  const settings = await getAppSettings();

  const stale = await db.select().from(calls).where(and(inArray(calls.status, ACTIVE), lt(calls.updatedAt, min(4))));
  for (const c of stale) {
    const limitMin = c.status === 'IN_PROGRESS' ? 20 : 4;
    if (c.updatedAt > min(limitMin)) continue;
    try {
      if (!c.isDemo && c.providerCallSid && settings.mode === 'live') {
        const info = await getTelephonyProvider('live').fetchCall(c.providerCallSid);
        const mapped = info ? mapProviderStatus(info.status) : null;
        if (mapped) {
          await applyCallStatus(c.id, mapped, { durationSeconds: info?.durationSeconds, payload: { source: 'reaper' } });
          result.calls++;
          continue;
        }
      }
      await applyCallStatus(c.id, 'FAILED', { errorCode: 'STALE', errorMessage: 'Call stopped reporting status and was closed by the reaper.', endReason: 'reaped' });
      result.calls++;
    } catch (err) {
      logger.warn({ callId: c.id, err: sanitizeError(err) }, 'reaper could not reconcile call');
    }
  }

  const leads = await db.update(campaignLeads).set({ status: 'PENDING', queuedAt: null, updatedAt: new Date() })
    .where(and(eq(campaignLeads.status, 'QUEUED'), lt(campaignLeads.queuedAt, min(10)))).returning({ id: campaignLeads.id });
  result.leads = leads.length;

  // IN_PROGRESS leads whose call is already finished but whose analysis never arrived stay for humans; leads with no active call return to the queue.
  const orphan = await db.execute(sql`
    update campaign_leads l set status = 'PENDING', updated_at = now()
    where l.status = 'IN_PROGRESS' and l.updated_at < ${min(30)}
      and not exists (select 1 from calls c where c.campaign_lead_id = l.id and (c.status in ('QUEUED','INITIATED','RINGING','IN_PROGRESS') or c.analyzed_at is null and c.status = 'COMPLETED'))`);
  result.leads += orphan.rowCount ?? 0;

  const imps = await db.update(customerImports).set({ status: 'FAILED', error: 'Processing was interrupted. Please re-upload or retry.' })
    .where(and(inArray(customerImports.status, ['VALIDATING', 'IMPORTING']), lt(customerImports.updatedAt, min(30)))).returning({ id: customerImports.id });
  result.imports = imps.length;

  const fu = await db.update(followUpTasks).set({ status: 'PENDING', updatedAt: new Date() })
    .where(and(eq(followUpTasks.status, 'PROCESSING'), lt(followUpTasks.updatedAt, min(10)))).returning({ id: followUpTasks.id });
  result.followUps = fu.length;
  return result;
}

/** Data hygiene. Transcript retention follows the admin-configured number of days (0 disables deletion). */
export async function runRetention() {
  const settings = await getAppSettings();
  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  const out: Record<string, number> = {};
  out.sessions = (await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id })).length;
  out.resetTokens = (await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, day(1))).returning({ id: passwordResetTokens.id })).length;
  out.webhookReceipts = (await db.delete(webhookReceipts).where(lt(webhookReceipts.receivedAt, day(30))).returning({ id: webhookReceipts.id })).length;
  out.jobs = (await db.delete(backgroundJobs).where(and(inArray(backgroundJobs.status, ['COMPLETED', 'CANCELED']), lt(backgroundJobs.updatedAt, day(30)))).returning({ id: backgroundJobs.id })).length;
  if (settings.retentionDays > 0) {
    out.transcripts = (await db.delete(transcripts).where(lt(transcripts.createdAt, day(settings.retentionDays))).returning({ id: transcripts.id })).length;
  }
  void auditLogs; // audit logs are intentionally never auto-deleted
  return out;
}
