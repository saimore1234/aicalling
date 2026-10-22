'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { ArrowLeft, Phone, Mail, Archive, ShieldOff } from 'lucide-react';
import { useMe } from '@/components/AppShell';
import { ConsentBadge } from '@/components/ConsentBadge';
import { useStages } from '@/components/hooks';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ConfirmDialog, DemoBadge, EmptyState, ErrorBox, Field, Input, Modal, Notice, Select, Spinner, Tabs, Textarea } from '@/components/ui';
import { api, useApi } from '@/lib/client/fetcher';
import { fmtDate, label, OUTCOME_LABEL, OUTCOME_TONE } from '@/lib/client/format';

type Detail = {
  customer: { id: string; name: string; company: string | null; phone: string | null; email: string | null; country: string | null; timezone: string | null; language: string | null; productInterest: string | null; category: string | null; leadSource: string | null; leadScore: number | null; leadScoreReason: string | null; doNotCall: boolean; isDemo: boolean; archivedAt: string | null; stageId: string | null; notes: string | null; lastOutcome: string | null; customFields: Record<string, string> };
  owner: { name: string } | null; stage: { name: string } | null;
  qualification: { outcome: string; score: number; reason: string; evidence: string[]; nextStep: string | null; createdAt: string; isDemo: boolean } | null;
  consent: Record<string, { status: string; source: string | null; capturedAt: string } | undefined>;
  consentHistory: { id: string; channel: string; status: string; source: string | null; evidence: string | null; capturedAt: string }[];
  suppressions: { id: string; channel: string | null; reason: string; createdAt: string; liftedAt: string | null }[];
  counts: { calls: number; messages: number };
};
type Item = { id: string; type: string; at: string; title: string; detail?: string | null; status?: string | null; demo?: boolean; href?: string };
const CHANNELS = ['VOICE', 'SMS', 'EMAIL', 'WHATSAPP'] as const;

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { isAdmin } = useMe();
  const toast = useToast();
  const { data, error, mutate } = useApi<Detail>(`/api/customers/${id}`);
  const tl = useApi<{ items: Item[] }>(`/api/customers/${id}/timeline`);
  const stages = useStages().data?.stages ?? [];
  const [tab, setTab] = useState<'timeline' | 'compliance' | 'details'>('timeline');
  const [note, setNote] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  const [optOutOpen, setOptOutOpen] = useState(false);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const { customer: c } = data;
  const refresh = () => { void mutate(); void tl.mutate(); };

  async function changeStage(stageId: string) { try { await api(`/api/customers/${id}/stage`, { method: 'PATCH', body: { stageId } }); toast.ok('Stage updated'); refresh(); } catch (e) { toast.error((e as Error).message); } }
  async function addNote() { if (!note.trim()) return; try { await api(`/api/customers/${id}/notes`, { body: { body: note } }); setNote(''); refresh(); } catch (e) { toast.error((e as Error).message); } }
  async function archive() { try { await api(`/api/customers/${id}/archive`, { body: { archived: !c.archivedAt } }); toast.ok(c.archivedAt ? 'Restored' : 'Archived'); refresh(); } catch (e) { toast.error((e as Error).message); } }

  return (
    <>
      <Link href="/customers" className="muted mb-3 inline-flex items-center gap-1 text-sm hover:underline"><ArrowLeft className="h-4 w-4" />Customers</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.name} {c.isDemo && <DemoBadge className="align-middle" />}</h1>
          <p className="muted text-sm">{[c.company, c.country].filter(Boolean).join(' · ') || '—'}</p>
          <div className="mt-2 flex flex-wrap gap-2">{c.doNotCall && <Badge tone="red">Do not call</Badge>}{c.archivedAt && <Badge>Archived</Badge>}{c.lastOutcome && <Badge tone={OUTCOME_TONE[c.lastOutcome]}>{OUTCOME_LABEL[c.lastOutcome]}</Badge>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Pipeline stage" className="w-48" value={c.stageId ?? ''} onChange={(e) => void changeStage(e.target.value)}>{!c.stageId && <option value="">No stage</option>}{stages.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          {isAdmin && <Button onClick={() => void archive()}><Archive className="h-4 w-4" />{c.archivedAt ? 'Restore' : 'Archive'}</Button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card title="Contact">
            <dl className="space-y-2 text-sm">
              <div className="flex items-center gap-2"><Phone className="muted h-4 w-4" />{c.phone ?? '—'}</div>
              <div className="flex items-center gap-2"><Mail className="muted h-4 w-4" />{c.email ?? '—'}</div>
              <div className="muted text-xs">Timezone: {c.timezone ?? 'not set'} · Language: {c.language ?? 'not set'}</div>
              <div className="muted text-xs">Owner: {data.owner?.name ?? 'Unassigned'} · Stage: {data.stage?.name ?? '—'}</div>
            </dl>
          </Card>
          <Card title="Latest AI qualification">
            {data.qualification ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><Badge tone={OUTCOME_TONE[data.qualification.outcome]}>{OUTCOME_LABEL[data.qualification.outcome]}</Badge><span className="font-semibold tabular-nums">{data.qualification.score}/100</span>{data.qualification.isDemo && <DemoBadge />}</div>
                <p>{data.qualification.reason}</p>
                {data.qualification.evidence.length > 0 && <ul className="muted list-disc space-y-1 pl-4 text-xs">{data.qualification.evidence.map((e, i) => <li key={i}>“{e}”</li>)}</ul>}
                {data.qualification.nextStep && <p><strong>Next step:</strong> {data.qualification.nextStep}</p>}
                <p className="muted text-xs">{fmtDate(data.qualification.createdAt)}</p>
              </div>
            ) : <p className="muted text-sm">No calls analysed yet.</p>}
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'timeline', label: 'Timeline' }, { id: 'compliance', label: 'Consent & compliance' }, { id: 'details', label: 'Details' }]} />
          {tab === 'timeline' && (
            <div className="space-y-4">
              <Card>
                <Field label="Add a note">{(fid) => <Textarea id={fid} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should the next person know?" />}</Field>
                <div className="mt-2 flex justify-end"><Button variant="primary" onClick={() => void addNote()} disabled={!note.trim()}>Save note</Button></div>
              </Card>
              <Card>
                {!tl.data ? <Spinner /> : tl.data.items.length === 0 ? <EmptyState title="No activity yet" /> : (
                  <ol className="space-y-4">
                    {tl.data.items.map((i) => (
                      <li key={`${i.type}-${i.id}`} className="flex gap-3">
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge>{label(i.type)}</Badge>
                            {i.href ? <Link href={i.href} className="font-medium hover:underline">{i.title}</Link> : <span className="font-medium">{i.title}</span>}
                            {i.status && <Badge tone="blue">{label(i.status)}</Badge>}{i.demo && <DemoBadge />}
                          </div>
                          {i.detail && <p className="muted mt-0.5 whitespace-pre-wrap text-sm">{i.detail}</p>}
                          <p className="muted text-xs">{fmtDate(i.at)}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
          )}
          {tab === 'compliance' && (
            <div className="space-y-4">
              {data.suppressions.some((s) => !s.liftedAt) && <Notice tone="red" title="Suppressed">This customer is on the suppression list and will not be contacted on the affected channels.</Notice>}
              <Card title="Consent by channel" actions={isAdmin ? <Button size="sm" onClick={() => setConsentOpen(true)}>Record consent</Button> : undefined}>
                <div className="grid gap-3 sm:grid-cols-2">
                  {CHANNELS.map((ch) => { const s = data.consent[ch]; return (
                    <div key={ch} className="rounded-lg border border-[rgb(var(--border))] p-3 text-sm"><div className="mb-1 flex items-center justify-between"><strong>{label(ch)}</strong><ConsentBadge status={s?.status ?? 'UNKNOWN'} /></div><p className="muted text-xs">{s ? `${s.source ?? 'no source'} · ${fmtDate(s.capturedAt, { time: false })}` : 'Never recorded'}</p></div>
                  ); })}
                </div>
                {isAdmin && <div className="mt-4 flex justify-end"><Button variant="danger" size="sm" onClick={() => setOptOutOpen(true)}><ShieldOff className="h-4 w-4" />Record opt-out</Button></div>}
              </Card>
              <Card title="Consent history (append-only)">
                {data.consentHistory.length === 0 ? <p className="muted text-sm">Nothing recorded.</p> : (
                  <ul className="divide-y divide-[rgb(var(--border))] text-sm">{data.consentHistory.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 py-2"><Badge>{label(h.channel)}</Badge><ConsentBadge status={h.status} /><span className="muted text-xs">{h.source} · {fmtDate(h.capturedAt)}</span>{h.evidence && <span className="muted w-full text-xs">{h.evidence}</span>}</li>)}</ul>
                )}
              </Card>
            </div>
          )}
          {tab === 'details' && (
            <Card>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {([['Product of interest', c.productInterest], ['Category', c.category], ['Lead source', c.leadSource], ['Lead score', c.leadScore !== null ? `${c.leadScore}/100` : null], ['Score reason', c.leadScoreReason]] as [string, string | null][]).map(([k, v]) => <div key={k}><dt className="muted text-xs">{k}</dt><dd>{v ?? '—'}</dd></div>)}
                {Object.entries(c.customFields ?? {}).map(([k, v]) => <div key={k}><dt className="muted text-xs">{k}</dt><dd>{v}</dd></div>)}
                {c.notes && <div className="sm:col-span-2"><dt className="muted text-xs">Notes from import</dt><dd className="whitespace-pre-wrap">{c.notes}</dd></div>}
              </dl>
            </Card>
          )}
        </div>
      </div>
      <ConsentModal id={id} open={consentOpen} onClose={() => setConsentOpen(false)} onDone={() => { setConsentOpen(false); refresh(); }} />
      <OptOutDialog id={id} open={optOutOpen} onClose={() => setOptOutOpen(false)} onDone={() => { setOptOutOpen(false); refresh(); }} />
    </>
  );
}

function ConsentModal({ id, open, onClose, onDone }: { id: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ channel: 'VOICE', status: 'GRANTED', source: '', evidence: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api(`/api/customers/${id}/consent`, { body: { ...f, evidence: f.evidence || undefined } }); toast.ok('Consent recorded'); onDone(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Record consent" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.source.trim()} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Notice tone="blue">Only record consent you can prove. State where and how the customer gave it — this is what you would show a regulator.</Notice>
        <Field label="Channel">{(i) => <Select id={i} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>}</Field>
        <Field label="Status">{(i) => <Select id={i} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="GRANTED">Granted</option><option value="DENIED">Denied</option><option value="WITHDRAWN">Withdrawn</option></Select>}</Field>
        <Field label="Source" hint="e.g. Website form 12 May, signed agreement, verbal on recorded call">{(i) => <Input id={i} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />}</Field>
        <Field label="Evidence reference (optional)">{(i) => <Textarea id={i} value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}
function OptOutDialog({ id, open, onClose, onDone }: { id: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); try { await api(`/api/customers/${id}/opt-out`, { body: { channels: 'ALL' } }); toast.ok('Opt-out recorded on all channels'); onDone(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }
  return <ConfirmDialog open={open} onClose={onClose} onConfirm={go} loading={busy} danger title="Record opt-out" confirmLabel="Opt out on all channels"><p>This stops all calls and messages to this customer immediately and cancels queued attempts. Lifting it later requires an administrator and a written reason.</p></ConfirmDialog>;
}
