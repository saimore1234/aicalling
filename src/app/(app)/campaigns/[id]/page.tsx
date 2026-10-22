'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DemoBadge, ErrorBox, Notice, PageHeader, Spinner, Stat, Table, TBody, THead } from '@/components/ui';
import { api, useApi } from '@/lib/client/fetcher';
import { fmtDate, fmtDuration, label, OUTCOME_LABEL, OUTCOME_TONE } from '@/lib/client/format';
import { CampaignForm, STATUS_TONE, type CampaignFormData } from '@/components/campaign-form';

type CallRow = { id: string; status: string; outcome: string | null; startedAt: string | null; durationSeconds: number | null; to: string; name: string; isDemo: boolean; attempt: number };
type Live = {
  campaign: CampaignFormData & { id: string; status: string; isDemo: boolean; launchConfirmedAt: string | null; launchedAt: string | null; stopReason: string | null };
  leads: Record<string, number>; outcomes: Record<string, number>; activeCalls: CallRow[]; recentCalls: CallRow[];
};
type Readiness = { ready: boolean; problems: { field: string; message: string; severity: 'error' | 'warning' }[]; leadCount: number; mode: string };

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const live = useApi<Live>(`/api/campaigns/${id}/live`, { refreshInterval: 5000 });
  const ready = useApi<Readiness>(`/api/campaigns/${id}/readiness`, { refreshInterval: 15000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [hangUp, setHangUp] = useState(true);
  const [confirmDel, setConfirmDel] = useState(false);

  if (live.error) return <ErrorBox error={live.error} onRetry={() => void live.mutate()} />;
  if (!live.data) return <Spinner />;
  const { campaign: c, leads, outcomes } = live.data;
  const total = Object.values(leads).reduce((a, b) => a + b, 0);
  const done = (leads.COMPLETED ?? 0) + (leads.FAILED ?? 0) + (leads.SKIPPED ?? 0) + (leads.CANCELED ?? 0);

  async function act(name: string, path: string, body?: unknown, msg?: string) {
    setBusy(name);
    try { await api(`/api/campaigns/${id}/${path}`, { body: body ?? {} }); toast.ok(msg ?? 'Done'); await Promise.all([live.mutate(), ready.mutate()]); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function remove() {
    try { await api(`/api/campaigns/${id}`, { method: 'DELETE' }); toast.ok('Campaign deleted'); router.push('/campaigns'); } catch (e) { toast.error((e as Error).message); setConfirmDel(false); }
  }
  const editable = ['DRAFT', 'PAUSED'].includes(c.status);
  const needsConfirm = !c.isDemo && !c.launchConfirmedAt;

  return (
    <>
      <PageHeader title={c.name} description={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{label(c.status)}</Badge>{c.isDemo ? <DemoBadge /> : <Badge tone="red">LIVE — real calls</Badge>}{c.isTest && <Badge tone="purple">Test</Badge>}{c.stopReason && <span className="muted text-xs">{c.stopReason}</span>}</span>}
        actions={<div className="flex flex-wrap gap-2">
          {editable && <Button onClick={() => setEditing(true)}>Edit</Button>}
          {editable && needsConfirm && <Button variant="danger" onClick={() => setConfirmLive(true)}>Confirm live launch</Button>}
          {c.status === 'DRAFT' && <Button variant="primary" loading={busy === 'start'} disabled={ready.data ? !ready.data.ready : true} onClick={() => void act('start', 'start', undefined, 'Campaign started')}>Start</Button>}
          {c.status === 'PAUSED' && <Button variant="primary" loading={busy === 'resume'} disabled={ready.data ? !ready.data.ready : true} onClick={() => void act('resume', 'resume', undefined, 'Campaign resumed')}>Resume</Button>}
          {c.status === 'RUNNING' && <Button loading={busy === 'pause'} onClick={() => void act('pause', 'pause', undefined, 'Campaign paused')}>Pause</Button>}
          {['RUNNING', 'PAUSED', 'DRAFT'].includes(c.status) && <Button variant="danger" onClick={() => setConfirmStop(true)}>Stop</Button>}
          {c.status !== 'RUNNING' && <Button variant="ghost" onClick={() => setConfirmDel(true)}>Delete</Button>}
        </div>} />

      {ready.data && ['DRAFT', 'PAUSED'].includes(c.status) && (
        <Card title="Launch readiness" className="mb-4" actions={<Badge tone={ready.data.ready ? 'green' : 'red'}>{ready.data.ready ? 'Ready' : 'Blocked'}</Badge>}>
          <div className="p-4">
            {ready.data.problems.length === 0 ? <p className="text-sm">All checks passed. {ready.data.leadCount} customer(s) waiting in the queue.</p> : (
              <ul className="space-y-1.5 text-sm">{ready.data.problems.map((p, i) => <li key={i} className={p.severity === 'error' ? 'text-red-600' : 'text-amber-700 dark:text-amber-400'}>{p.severity === 'error' ? '✕' : '⚠'} {p.message}</li>)}</ul>
            )}
          </div>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Progress" value={`${done} / ${total}`} hint="customers finished / queued" />
        <Stat label="Calling now" value={live.data.activeCalls.length} hint={`limit ${c.maxConcurrent} concurrent`} />
        <Stat label="Waiting" value={(leads.PENDING ?? 0) + (leads.QUEUED ?? 0) + (leads.RETRY_WAIT ?? 0)} hint={`${leads.RETRY_WAIT ?? 0} awaiting retry`} />
        <Stat label="Skipped by compliance" value={leads.SKIPPED ?? 0} hint="consent, DND, hours or policy" />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Outcomes" className="lg:col-span-1">
          <ul className="divide-y divide-[rgb(var(--border))] text-sm">
            {Object.keys(outcomes).length === 0 && <li className="muted p-4">No calls yet.</li>}
            {Object.entries(outcomes).sort((a, b) => b[1] - a[1]).map(([o, n]) => (
              <li key={o} className="flex items-center justify-between px-4 py-2"><Badge tone={OUTCOME_TONE[o] ?? 'neutral'}>{OUTCOME_LABEL[o] ?? (o === 'PENDING' ? 'In progress' : label(o))}</Badge><span className="tabular-nums">{n}</span></li>
            ))}
          </ul>
        </Card>
        <Card title="Live calls" className="lg:col-span-2" actions={<span className="muted text-xs">refreshes every 5 s</span>}>
          {live.data.activeCalls.length === 0 ? <p className="muted p-4 text-sm">No call in progress.</p> : (
            <Table><THead><th>Customer</th><th>Number</th><th>Status</th><th>Duration</th></THead>
              <TBody>{live.data.activeCalls.map((k) => <tr key={k.id}><td><Link className="text-brand-700 hover:underline dark:text-brand-300" href={`/calls/${k.id}`}>{k.name}</Link> {k.isDemo && <DemoBadge />}</td><td className="font-mono text-xs">{k.to}</td><td><Badge tone="blue">{label(k.status)}</Badge></td><td>{fmtDuration(k.durationSeconds)}</td></tr>)}</TBody>
            </Table>
          )}
        </Card>
      </div>

      <Card title="Recent calls">
        {live.data.recentCalls.length === 0 ? <p className="muted p-4 text-sm">Nothing has been dialled yet.</p> : (
          <Table><THead><th>When</th><th>Customer</th><th>Attempt</th><th>Status</th><th>Outcome</th><th>Duration</th></THead>
            <TBody>{live.data.recentCalls.map((k) => (
              <tr key={k.id}><td className="muted">{fmtDate(k.startedAt)}</td><td><Link className="text-brand-700 hover:underline dark:text-brand-300" href={`/calls/${k.id}`}>{k.name}</Link></td><td>#{k.attempt}</td><td>{label(k.status)}</td>
                <td>{k.outcome ? <Badge tone={OUTCOME_TONE[k.outcome] ?? 'neutral'}>{OUTCOME_LABEL[k.outcome] ?? label(k.outcome)}</Badge> : '—'}</td><td>{fmtDuration(k.durationSeconds)}</td></tr>))}</TBody>
          </Table>
        )}
      </Card>

      {editing && <CampaignForm id={id} existing={{ ...c, product: c.product ?? '', fallbackTimezone: c.fallbackTimezone ?? '', testPhone: c.testPhone ?? '' }} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void live.mutate(); void ready.mutate(); }} />}

      <ConfirmDialog open={confirmLive} onClose={() => setConfirmLive(false)} danger requireText="LAUNCH LIVE CALLS" confirmLabel="Confirm live launch" loading={busy === 'confirm'}
        title="Confirm live launch" onConfirm={() => { void act('confirm', 'confirm-launch', { confirm: 'LAUNCH LIVE CALLS' }, 'Live launch confirmed — you can now start the campaign'); setConfirmLive(false); }}>
        <Notice tone="red">Real people will receive real phone calls from an AI agent. Make sure consent, calling hours, DND scrubbing and the agent’s wording have been reviewed. Editing the campaign later removes this confirmation.</Notice>
      </ConfirmDialog>

      <ConfirmDialog open={confirmStop} onClose={() => setConfirmStop(false)} danger confirmLabel="Stop campaign" loading={busy === 'stop'} title="Stop campaign permanently"
        onConfirm={() => { void act('stop', 'stop', { hangUpActiveCalls: hangUp }, 'Campaign stopped'); setConfirmStop(false); }}>
        <p>Remaining customers are cancelled. A stopped campaign cannot be restarted.</p>
        <Checkbox label="Also hang up calls that are in progress right now" checked={hangUp} onChange={(e) => setHangUp(e.target.checked)} />
      </ConfirmDialog>

      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} danger confirmLabel="Delete" title="Delete campaign" onConfirm={() => void remove()}><p>The campaign is hidden from lists. Call history is kept.</p></ConfirmDialog>
    </>
  );
}
