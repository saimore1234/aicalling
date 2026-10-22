'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, Notice, PageHeader, Pagination, Select, Spinner, Table, Tabs, TBody, THead, Textarea } from '@/components/ui';
import { api, ApiClientError, qs, useApi } from '@/lib/client/fetcher';
import { fmtDate, label } from '@/lib/client/format';

type Tab = 'policies' | 'suppression' | 'consent' | 'privacy';

export default function CompliancePage() {
  const [tab, setTab] = useState<Tab>('policies');
  return (
    <>
      <PageHeader title="Compliance & consent" description="The compliance engine fails closed: if a rule cannot be satisfied or a policy has not been reviewed, contact is blocked rather than allowed." />
      <Notice tone="amber" title="This is configuration, not legal advice">The default country rules are conservative starting points that have <strong>not</strong> been reviewed by your counsel. Review each policy against current local law (e.g. India TRAI/TCCCPR and DLT registration) and attest it below before any live contact.</Notice>
      <div className="mt-4" />
      <Tabs<Tab> tabs={[{ id: 'policies', label: 'Country policies' }, { id: 'suppression', label: 'Suppression list' }, { id: 'consent', label: 'Consent ledger' }, { id: 'privacy', label: 'Privacy requests' }]} value={tab} onChange={setTab} />
      {tab === 'policies' && <Policies />}
      {tab === 'suppression' && <Suppression />}
      {tab === 'consent' && <Consent />}
      {tab === 'privacy' && <Privacy />}
    </>
  );
}

/* ---------------------------------- policies --------------------------------- */
type Policy = {
  id: string; countryCode: string; name: string; enabled: boolean; reviewed: boolean; reviewedAt: string | null; requireConsentVoice: boolean; requireConsentSms: boolean; requireConsentWhatsapp: boolean; requireConsentEmail: boolean;
  requireDndScrub: boolean; dndScrubConfirmedAt: string | null; requireDltTemplate: boolean; callWindowStart: string; callWindowEnd: string; allowedWeekdays: number[]; defaultTimezone: string | null; notes: string | null;
};
const WD = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Policies() {
  const { data, error, mutate } = useApi<{ policies: Policy[] }>('/api/compliance/policies');
  const [edit, setEdit] = useState<Policy | 'new' | null>(null);
  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Add country</Button></div>
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          <Table>
            <THead><th>Country</th><th>Contact</th><th>Review</th><th>Calling hours</th><th>Consent required</th><th>DND scrub</th><th /></THead>
            <TBody>{data.policies.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.countryCode} <span className="muted font-normal">{p.name}</span></td>
                <td><Badge tone={p.enabled ? 'green' : 'red'}>{p.enabled ? 'Enabled' : 'Blocked'}</Badge></td>
                <td><Badge tone={p.reviewed ? 'green' : 'amber'}>{p.reviewed ? `Reviewed ${fmtDate(p.reviewedAt, { time: false })}` : 'Not reviewed'}</Badge></td>
                <td className="text-xs">{p.callWindowStart}–{p.callWindowEnd}<div className="muted">{p.allowedWeekdays.map((d) => WD[d]).join(' ')}</div></td>
                <td className="text-xs">{[p.requireConsentVoice && 'Voice', p.requireConsentSms && 'SMS', p.requireConsentWhatsapp && 'WhatsApp', p.requireConsentEmail && 'Email'].filter(Boolean).join(', ') || 'none'}</td>
                <td className="text-xs">{p.requireDndScrub ? (p.dndScrubConfirmedAt ? <Badge tone="green">Confirmed {fmtDate(p.dndScrubConfirmedAt, { time: false })}</Badge> : <Badge tone="amber">Required — not confirmed</Badge>) : 'Not required'}{p.requireDltTemplate && <div className="muted">DLT templates required</div>}</td>
                <td className="text-right"><Button size="sm" onClick={() => setEdit(p)}>Review / edit</Button></td>
              </tr>))}</TBody>
          </Table>
        </Card>
      )}
      {edit && <PolicyEditor policy={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void mutate(); }} />}
    </>
  );
}

function PolicyEditor({ policy, onClose, onSaved }: { policy: Policy | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    countryCode: policy?.countryCode ?? '', name: policy?.name ?? '', enabled: policy?.enabled ?? true,
    requireConsentVoice: policy?.requireConsentVoice ?? true, requireConsentSms: policy?.requireConsentSms ?? true, requireConsentWhatsapp: policy?.requireConsentWhatsapp ?? true, requireConsentEmail: policy?.requireConsentEmail ?? true,
    requireDndScrub: policy?.requireDndScrub ?? false, requireDltTemplate: policy?.requireDltTemplate ?? false,
    callWindowStart: policy?.callWindowStart ?? '09:00', callWindowEnd: policy?.callWindowEnd ?? '20:00', allowedWeekdays: policy?.allowedWeekdays ?? [1, 2, 3, 4, 5], defaultTimezone: policy?.defaultTimezone ?? '', notes: policy?.notes ?? '',
  });
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [scrub, setScrub] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true); setError(null);
    const body = { ...f, defaultTimezone: f.defaultTimezone || null, notes: f.notes || null };
    try {
      if (policy) {
        const { countryCode: _c, ...rest } = body;
        await api(`/api/compliance/policies/${policy.countryCode}`, { method: 'PATCH', body: { ...rest, reviewed: attest } });
      } else await api('/api/compliance/policies', { body });
      toast.ok(policy ? (attest ? 'Policy saved and marked reviewed' : 'Policy saved — review status cleared until you attest') : 'Country added — review it before use'); onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function confirmScrub() {
    try { await api(`/api/compliance/policies/${policy!.countryCode}/confirm-dnd-scrub`, { body: { attest: true } }); toast.ok('DND scrub recorded'); setScrub(false); onSaved(); } catch (e) { toast.error((e as Error).message); }
  }
  const toggleDay = (d: number) => set('allowedWeekdays', f.allowedWeekdays.includes(d) ? f.allowedWeekdays.filter((x) => x !== d) : [...f.allowedWeekdays, d].sort());

  return (
    <Modal wide open onClose={onClose} title={policy ? `${policy.countryCode} — ${policy.name}` : 'Add country policy'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="space-y-4">
        {!!error && <ErrorBox error={error instanceof ApiClientError ? error : error} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Country code (ISO)">{(i) => <Input id={i} value={f.countryCode} maxLength={2} disabled={!!policy} onChange={(e) => set('countryCode', e.target.value.toUpperCase())} />}</Field>
          <Field label="Name">{(i) => <Input id={i} value={f.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <Field label="Default timezone" hint="Only for single-timezone countries">{(i) => <Input id={i} value={f.defaultTimezone} onChange={(e) => set('defaultTimezone', e.target.value)} placeholder="Asia/Kolkata" />}</Field>
        </div>
        <Checkbox label="Contact with customers in this country is allowed" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <fieldset className="rounded-lg border border-[rgb(var(--border))] p-3"><legend className="px-1 text-sm font-semibold">Prior consent required for</legend>
          <div className="flex flex-wrap gap-4">
            <Checkbox label="Voice calls" checked={f.requireConsentVoice} onChange={(e) => set('requireConsentVoice', e.target.checked)} />
            <Checkbox label="SMS" checked={f.requireConsentSms} onChange={(e) => set('requireConsentSms', e.target.checked)} />
            <Checkbox label="WhatsApp" checked={f.requireConsentWhatsapp} onChange={(e) => set('requireConsentWhatsapp', e.target.checked)} />
            <Checkbox label="Email" checked={f.requireConsentEmail} onChange={(e) => set('requireConsentEmail', e.target.checked)} />
          </div>
        </fieldset>
        <fieldset className="space-y-2 rounded-lg border border-[rgb(var(--border))] p-3"><legend className="px-1 text-sm font-semibold">Calling hours (customer local time)</legend>
          <div className="flex flex-wrap items-center gap-2"><Input aria-label="Start" type="time" className="w-28" value={f.callWindowStart} onChange={(e) => set('callWindowStart', e.target.value)} />to<Input aria-label="End" type="time" className="w-28" value={f.callWindowEnd} onChange={(e) => set('callWindowEnd', e.target.value)} /></div>
          <div className="flex gap-1">{[1, 2, 3, 4, 5, 6, 7].map((d) => <button type="button" key={d} aria-pressed={f.allowedWeekdays.includes(d)} onClick={() => toggleDay(d)} className={`rounded-md border px-2 py-1 text-xs ${f.allowedWeekdays.includes(d) ? 'border-brand-600 bg-brand-600 text-white' : 'border-[rgb(var(--border))]'}`}>{WD[d]}</button>)}</div>
        </fieldset>
        <div className="space-y-2">
          <Checkbox label="Require do-not-call registry scrub (e.g. India NDNC / TRAI preference register)" checked={f.requireDndScrub} onChange={(e) => set('requireDndScrub', e.target.checked)} />
          {policy?.requireDndScrub && f.requireDndScrub && <div className="flex items-center gap-3 pl-6 text-sm">{policy.dndScrubConfirmedAt ? <span>Scrub confirmed {fmtDate(policy.dndScrubConfirmedAt)}</span> : <span className="text-amber-700">Not yet confirmed — calls to this country are blocked.</span>}<Button size="sm" onClick={() => setScrub(true)}>Record scrub</Button></div>}
          <Checkbox label="Require registered DLT templates for SMS (India)" checked={f.requireDltTemplate} onChange={(e) => set('requireDltTemplate', e.target.checked)} />
        </div>
        <Field label="Notes (legal basis, counsel sign-off reference)">{(i) => <Textarea id={i} rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />}</Field>
        {policy && (
          <div className="rounded-lg border border-[rgb(var(--border))] p-3">
            <Checkbox label="I have reviewed these rules against current local law and attest they are correct for live contact" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
            <p className="muted mt-1 pl-6 text-xs">Saving any rule change without ticking this clears the review and blocks live contact until it is attested again.</p>
          </div>
        )}
      </div>
      <ConfirmDialog open={scrub} onClose={() => setScrub(false)} onConfirm={() => void confirmScrub()} title="Record DND registry scrub" confirmLabel="I attest"><p>I attest that the customer list for this country has been scrubbed against the national do-not-call registry before dialling.</p></ConfirmDialog>
    </Modal>
  );
}

/* --------------------------------- suppression -------------------------------- */
type Supp = { id: string; phone: string | null; email: string | null; channel: string | null; reason: string; source: string; note: string | null; createdAt: string; liftedAt: string | null };
function Suppression() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('true');
  const { data, error, mutate } = useApi<{ records: Supp[]; total: number }>(`/api/compliance/suppression${qs({ page, pageSize: 25, active })}`, { keepPreviousData: true });
  const [add, setAdd] = useState(false);
  const [lift, setLift] = useState<Supp | null>(null);
  const [reason, setReason] = useState('');
  async function doLift() {
    try { await api(`/api/compliance/suppression/${lift!.id}`, { method: 'DELETE', body: { reason } }); toast.ok('Suppression lifted'); setLift(null); setReason(''); await mutate(); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Select aria-label="State" className="w-40" value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}><option value="true">Active</option><option value="false">Lifted</option><option value="">All</option></Select>
        <Button onClick={() => setAdd(true)}><Plus className="h-4 w-4" />Add suppression</Button>
      </div>
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : data.records.length === 0 ? <Card><EmptyState title="No suppression records" /></Card> : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <THead><th>Contact</th><th>Channel</th><th>Reason</th><th>Added</th><th /></THead>
              <TBody>{data.records.map((r) => (
                <tr key={r.id}><td className="font-mono text-xs">{r.phone ?? r.email}</td><td>{r.channel ? label(r.channel) : 'All channels'}</td><td>{label(r.reason)}<div className="muted text-xs">{r.source}{r.note && ` · ${r.note}`}</div></td>
                  <td className="muted">{fmtDate(r.createdAt)}</td><td className="text-right">{r.liftedAt ? <Badge>Lifted {fmtDate(r.liftedAt, { time: false })}</Badge> : <Button size="sm" variant="ghost" onClick={() => setLift(r)}>Lift…</Button>}</td></tr>))}</TBody>
            </Table>
          </Card>
          <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />
        </>
      )}
      {add && <AddSuppression onClose={() => setAdd(false)} onSaved={() => { setAdd(false); void mutate(); }} />}
      <ConfirmDialog open={!!lift} onClose={() => setLift(null)} onConfirm={() => void doLift()} danger title="Lift suppression" confirmLabel="Lift suppression">
        <Notice tone="red">Lifting a suppression allows this contact to be contacted again. Only do this if the person has clearly asked to be contacted. The reason is recorded in the audit log.</Notice>
        <Field label="Reason (min. 10 characters)">{(i) => <Textarea id={i} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </ConfirmDialog>
    </>
  );
}
function AddSuppression({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ phone: '', email: '', channel: '', reason: 'ADMIN', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setBusy(true); setError(null);
    try { await api('/api/compliance/suppression', { body: { phone: f.phone || undefined, email: f.email || undefined, channel: f.channel || null, reason: f.reason, note: f.note || undefined } }); toast.ok('Added to suppression list'); onSaved(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Add suppression" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Add</Button></>}>
      <div className="space-y-3">
        {!!error && <ErrorBox error={error} />}
        <Field label="Phone number">{(i) => <Input id={i} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+919800000000" />}</Field>
        <Field label="…or email">{(i) => <Input id={i} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Channel">{(i) => <Select id={i} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="">All channels</option><option value="VOICE">Voice only</option><option value="SMS">SMS only</option><option value="EMAIL">Email only</option><option value="WHATSAPP">WhatsApp only</option></Select>}</Field>
        <Field label="Reason">{(i) => <Select id={i} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}><option value="CUSTOMER_OPT_OUT">Customer opt-out</option><option value="DNC_REGISTRY">DNC registry</option><option value="WRONG_NUMBER">Wrong number</option><option value="ADMIN">Administrator decision</option></Select>}</Field>
        <Field label="Note">{(i) => <Input id={i} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}

/* ----------------------------------- consent ---------------------------------- */
type ConsentRow = { id: string; customerId: string; customerName: string; channel: string; status: string; source: string | null; capturedAt: string; evidence: string | null };
function Consent() {
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const { data, error, mutate } = useApi<{ records: ConsentRow[]; total: number }>(`/api/compliance/consent${qs({ page, pageSize: 25, channel, status })}`, { keepPreviousData: true });
  return (
    <>
      <p className="muted mb-3 text-sm">Append-only ledger. A customer’s current consent for a channel is the newest row; withdrawals are new rows, never edits.</p>
      <div className="mb-4 flex gap-2">
        <Select aria-label="Channel" className="w-40" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}><option value="">All channels</option>{['VOICE', 'SMS', 'EMAIL', 'WHATSAPP'].map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
        <Select aria-label="Status" className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{['GRANTED', 'DENIED', 'WITHDRAWN', 'UNKNOWN'].map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
      </div>
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : data.records.length === 0 ? <Card><EmptyState title="No consent records" /></Card> : (
        <>
          <Card className="overflow-hidden"><Table>
            <THead><th>Captured</th><th>Customer</th><th>Channel</th><th>Status</th><th>Source</th></THead>
            <TBody>{data.records.map((r) => <tr key={r.id}><td className="muted whitespace-nowrap">{fmtDate(r.capturedAt)}</td><td>{r.customerName}</td><td>{label(r.channel)}</td><td><Badge tone={r.status === 'GRANTED' ? 'green' : r.status === 'UNKNOWN' ? 'neutral' : 'red'}>{label(r.status)}</Badge></td><td className="text-xs">{r.source}{r.evidence && <div className="muted">{r.evidence}</div>}</td></tr>)}</TBody>
          </Table></Card>
          <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

/* ----------------------------------- privacy ---------------------------------- */
type PrivReq = { id: string; customerRef: string | null; type: string; createdAt: string; completedAt: string | null; notes: string | null };
function Privacy() {
  const toast = useToast();
  const { data, mutate } = useApi<{ requests: PrivReq[] }>('/api/compliance/privacy');
  const [q, setQ] = useState('');
  const found = useApi<{ customers: { id: string; name: string; company: string | null }[] }>(q.length >= 2 ? `/api/customers${qs({ q, pageSize: 6 })}` : null);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [erase, setErase] = useState(false);
  async function exportData() {
    try {
      const res = await fetch('/api/compliance/privacy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: target!.id, type: 'EXPORT' }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Export failed');
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `export-${target!.id}.json`; a.click(); URL.revokeObjectURL(a.href);
      toast.ok('Export downloaded'); await mutate();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function doErase() {
    try { await api('/api/compliance/privacy', { body: { customerId: target!.id, type: 'ERASE', confirm: 'ERASE' } }); toast.ok('Personal data erased'); setErase(false); setTarget(null); setQ(''); await mutate(); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <>
      <Card title="Handle a data-subject request" className="mb-6">
        <div className="space-y-3 p-4 text-sm">
          <p className="muted">Export returns everything held about a person as JSON. Erasure removes personal data but keeps a suppression entry for their phone/email so they are never contacted or re-imported.</p>
          <Field label="Find customer">{(i) => <Input id={i} value={q} onChange={(e) => { setQ(e.target.value); setTarget(null); }} placeholder="Name, email or phone" />}</Field>
          {!target && found.data?.customers.length ? <ul className="divide-y divide-[rgb(var(--border))] rounded-lg border border-[rgb(var(--border))]">{found.data.customers.map((c) => <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-[rgb(var(--surface-2))]" onClick={() => { setTarget({ id: c.id, name: c.name }); setQ(c.name); }}>{c.name}<span className="muted"> {c.company}</span></button></li>)}</ul> : null}
          {target && <div className="flex gap-2"><Button onClick={() => void exportData()}>Export data (JSON)</Button><Button variant="danger" onClick={() => setErase(true)}>Erase personal data…</Button></div>}
        </div>
      </Card>
      <Card title="Request log">
        {!data ? <Spinner /> : data.requests.length === 0 ? <p className="muted p-4 text-sm">No requests yet.</p> : (
          <Table><THead><th>When</th><th>Type</th><th>Subject</th><th>Completed</th></THead><TBody>{data.requests.map((r) => <tr key={r.id}><td className="muted">{fmtDate(r.createdAt)}</td><td>{label(r.type)}</td><td>{r.customerRef}</td><td>{fmtDate(r.completedAt)}</td></tr>)}</TBody></Table>
        )}
      </Card>
      <ConfirmDialog open={erase} onClose={() => setErase(false)} danger requireText="ERASE" confirmLabel="Erase permanently" title={`Erase ${target?.name ?? ''}`} onConfirm={() => void doErase()}>
        <p>Profile, notes, transcripts and message contents are permanently removed. This cannot be undone.</p>
      </ConfirmDialog>
    </>
  );
}
