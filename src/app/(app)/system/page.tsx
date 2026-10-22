'use client';
import { useState } from 'react';
import { OctagonAlert } from 'lucide-react';
import { useMe } from '@/components/AppShell';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ConfirmDialog, ErrorBox, Field, Input, Notice, PageHeader, Pagination, Select, Spinner, Stat, Table, TBody, THead, Textarea } from '@/components/ui';
import { api, qs, useApi } from '@/lib/client/fetcher';
import { fmtDate, label } from '@/lib/client/format';

type Check = { ok: boolean; detail?: string; latencyMs?: number };
type Health = { checkedAt: string; mode: string; killSwitch: boolean; killSwitchReason: string | null; checks: Record<string, Check>; queues: Record<string, Record<string, number>>; activeCalls: number; healthy: boolean };
type Job = { id: string; queue: string; name: string; status: string; attempts: number; error: string | null; updatedAt: string; relatedType: string | null; relatedId: string | null };
type Settings = { timezone: string; retentionDays: number; rateLimits: { callsPerMinute: number; messagesPerMinute: number } };
const CHECK_LABEL: Record<string, string> = { database: 'PostgreSQL', redis: 'Redis', worker: 'Background worker', voiceGateway: 'Voice gateway' };
const PAGE = 20;

export default function SystemPage() {
  const toast = useToast();
  const { refresh } = useMe();
  const health = useApi<Health>('/api/system/health', { refreshInterval: 10000 });
  const settings = useApi<{ settings: Settings }>('/api/system/settings');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('FAILED');
  const jobs = useApi<{ jobs: Job[]; total: number }>(`/api/system/jobs${qs({ page, pageSize: PAGE, status })}`, { refreshInterval: 15000 });
  const [killOpen, setKillOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function kill() {
    setBusy(true);
    try { const r = await api<{ hungUp?: number }>('/api/system/kill-switch', { body: { reason } }); toast.ok(`Kill switch ON${r.hungUp ? ` — ${r.hungUp} call(s) ended` : ''}`); setKillOpen(false); setReason(''); await health.mutate(); refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function release() {
    setBusy(true);
    try { await api('/api/system/kill-switch', { method: 'DELETE' }); toast.ok('Kill switch released. Campaigns stay paused until you resume them.'); await health.mutate(); refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function retry(id: string) {
    try { await api(`/api/system/jobs/${id}/retry`, { body: {} }); toast.ok('Job re-queued'); await jobs.mutate(); } catch (e) { toast.error((e as Error).message); }
  }

  const h = health.data;
  return (
    <>
      <PageHeader title="System health" description="Live status of the processes the platform depends on, the emergency kill switch, and background-job failures." />
      <Card className="mb-6" title="Emergency kill switch" actions={h && <Badge tone={h.killSwitch ? 'red' : 'green'}>{h.killSwitch ? 'ACTIVE — all dialling blocked' : 'Off'}</Badge>}>
        <div className="space-y-3 p-4 text-sm">
          <p>Immediately blocks all outbound calls and message sends, pauses running campaigns and hangs up calls in progress. Use it if the agent misbehaves or a complaint arrives.</p>
          {h?.killSwitch ? (
            <div className="space-y-2"><Notice tone="red">Reason: {h.killSwitchReason ?? 'not recorded'}</Notice><Button onClick={() => void release()} loading={busy}>Release kill switch</Button></div>
          ) : <Button variant="danger" onClick={() => setKillOpen(true)}><OctagonAlert className="h-4 w-4" />Activate kill switch</Button>}
        </div>
      </Card>

      {health.error ? <ErrorBox error={health.error} onRetry={() => void health.mutate()} /> : !h ? <Spinner /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            {Object.entries(h.checks).map(([k, c]) => <Stat key={k} label={CHECK_LABEL[k] ?? k} value={c.ok ? 'OK' : 'Down'} tone={c.ok ? 'good' : 'bad'} hint={c.detail ?? (c.latencyMs !== undefined ? `${c.latencyMs} ms` : undefined)} />)}
            <Stat label="Calls in progress" value={h.activeCalls} hint={`mode: ${h.mode}`} />
          </div>
          <Card title="Queues" className="mb-6">
            <Table>
              <THead><th>Queue</th><th className="text-right">Waiting</th><th className="text-right">Active</th><th className="text-right">Delayed</th><th className="text-right">Failed</th></THead>
              <TBody>{Object.entries(h.queues).map(([q, c]) => <tr key={q}><td className="font-mono text-xs">{q}</td><td className="text-right">{c.waiting ?? '—'}</td><td className="text-right">{c.active ?? '—'}</td><td className="text-right">{c.delayed ?? '—'}</td><td className={`text-right ${c.failed ? 'font-semibold text-red-600' : ''}`}>{c.failed ?? '—'}</td></tr>)}</TBody>
            </Table>
          </Card>
        </>
      )}

      <Card title="Background jobs" className="mb-6" actions={<Select aria-label="Job status" className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option>{['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}>
        {!jobs.data ? <Spinner /> : jobs.data.jobs.length === 0 ? <p className="muted p-4 text-sm">No jobs with this status.</p> : (
          <>
            <Table>
              <THead><th>Updated</th><th>Queue / job</th><th>Status</th><th>Error</th><th /></THead>
              <TBody>{jobs.data.jobs.map((j) => (
                <tr key={j.id}><td className="muted whitespace-nowrap">{fmtDate(j.updatedAt)}</td><td><span className="font-mono text-xs">{j.queue}</span><div className="muted text-xs">{j.name} · attempt {j.attempts}</div></td>
                  <td><Badge tone={j.status === 'FAILED' ? 'red' : j.status === 'COMPLETED' ? 'green' : 'amber'}>{label(j.status)}</Badge></td><td className="max-w-xs break-words text-xs text-red-600">{j.error}</td>
                  <td className="text-right">{j.status === 'FAILED' && <Button size="sm" onClick={() => void retry(j.id)}>Retry</Button>}</td></tr>))}</TBody>
            </Table>
            <div className="px-4 pb-3"><Pagination page={page} pageSize={PAGE} total={jobs.data.total} onPage={setPage} /></div>
          </>
        )}
      </Card>

      {settings.data && <SettingsCard initial={settings.data.settings} onSaved={() => void settings.mutate()} />}

      <ConfirmDialog open={killOpen} onClose={() => setKillOpen(false)} danger loading={busy} confirmLabel="Activate kill switch" title="Activate emergency kill switch" onConfirm={() => { if (reason.trim().length >= 3) void kill(); else toast.error('Enter a reason (at least 3 characters).'); }}>
        <p>All dialling stops now and calls in progress are ended.</p>
        <Field label="Reason (recorded in the audit log)">{(i) => <Textarea id={i} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </ConfirmDialog>
    </>
  );
}

function SettingsCard({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api('/api/system/settings', { method: 'PATCH', body: { timezone: f.timezone, retentionDays: f.retentionDays, rateLimits: f.rateLimits } }); toast.ok('Settings saved'); onSaved(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Card title="Operational settings">
      <div className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Business timezone" hint="IANA name">{(i) => <Input id={i} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />}</Field>
          <Field label="Retention (days)" hint="0 = keep forever. Applies to transcripts.">{(i) => <Input id={i} type="number" min={0} value={f.retentionDays} onChange={(e) => setF({ ...f, retentionDays: Number(e.target.value) })} />}</Field>
          <Field label="Calls per minute (global)">{(i) => <Input id={i} type="number" min={1} value={f.rateLimits.callsPerMinute} onChange={(e) => setF({ ...f, rateLimits: { ...f.rateLimits, callsPerMinute: Number(e.target.value) } })} />}</Field>
          <Field label="Messages per minute (global)">{(i) => <Input id={i} type="number" min={1} value={f.rateLimits.messagesPerMinute} onChange={(e) => setF({ ...f, rateLimits: { ...f.rateLimits, messagesPerMinute: Number(e.target.value) } })} />}</Field>
        </div>
        <Button variant="primary" loading={busy} onClick={() => void save()}>Save settings</Button>
      </div>
    </Card>
  );
}
