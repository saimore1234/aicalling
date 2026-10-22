'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Download, Plus, Search } from 'lucide-react';
import { useMe } from '@/components/AppShell';
import { ConsentBadge } from '@/components/ConsentBadge';
import { useStages, useUsers } from '@/components/hooks';
import { useToast } from '@/components/toast';
import { Badge, Button, DemoBadge, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, TBody, THead, Card } from '@/components/ui';
import { api, ApiClientError, qs, useApi } from '@/lib/client/fetcher';
import { fmtDate, OUTCOME_LABEL, OUTCOME_TONE } from '@/lib/client/format';

type Row = {
  id: string; name: string; company: string | null; phone: string | null; email: string | null; country: string | null; stageName: string | null; ownerName: string | null;
  leadScore: number | null; lastOutcome: string | null; lastContactedAt: string | null; doNotCall: boolean; isDemo: boolean; archivedAt: string | null; voiceConsent: string;
};
type List = { customers: Row[]; total: number; page: number; pageSize: number };

export default function CustomersPage() {
  const { isAdmin } = useMe();
  const toast = useToast();
  const [f, setF] = useState({ q: '', country: '', stageId: '', ownerId: '', consent: '', doNotCall: '', archived: '', demo: '', page: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const query = qs({ ...f, pageSize: 25 });
  const { data, error, isLoading, mutate } = useApi<List>(`/api/customers${query}`);
  const stages = useStages().data?.stages ?? [];
  const users = useUsers().data?.users ?? [];
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v, page: 1 }); setSelected(new Set()); };

  async function bulk(body: Record<string, unknown>, okMsg: string) {
    try { await api('/api/customers/bulk', { body: { ...body, ids: [...selected] } }); toast.ok(okMsg); setSelected(new Set()); void mutate(); }
    catch (e) { toast.error((e as Error).message); }
  }
  const rows = data?.customers ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <>
      <PageHeader title="Customers" description={isAdmin ? 'Everyone you can contact. Imports never imply consent — consent is recorded separately.' : 'Customers assigned to you.'}
        actions={isAdmin ? <>
          <a href={`/api/customers/export${qs({ ...f, page: undefined })}`}><Button><Download className="h-4 w-4" />Export CSV</Button></a>
          <Link href="/import"><Button>Import</Button></Link>
          <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Add customer</Button>
        </> : undefined} />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2"><Search className="muted pointer-events-none absolute left-3 top-2.5 h-4 w-4" /><Input aria-label="Search" placeholder="Search name, company, phone, email" className="pl-9" value={f.q} onChange={(e) => set('q', e.target.value)} /></div>
          <Select aria-label="Stage" value={f.stageId} onChange={(e) => set('stageId', e.target.value)}><option value="">All stages</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          {isAdmin && <Select aria-label="Owner" value={f.ownerId} onChange={(e) => set('ownerId', e.target.value)}><option value="">All owners</option><option value="none">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
          <Input aria-label="Country" placeholder="Country (e.g. IN)" maxLength={2} value={f.country} onChange={(e) => set('country', e.target.value.toUpperCase())} />
          <Select aria-label="Consent" value={f.consent} onChange={(e) => set('consent', e.target.value)}><option value="">Any consent</option><option value="GRANTED">Consent granted</option><option value="UNKNOWN">No consent on record</option><option value="WITHDRAWN">Withdrawn</option><option value="DENIED">Denied</option></Select>
          <Select aria-label="Do not call" value={f.doNotCall} onChange={(e) => set('doNotCall', e.target.value)}><option value="">DNC: any</option><option value="true">Do-not-call only</option><option value="false">Callable only</option></Select>
          <Select aria-label="Archived" value={f.archived} onChange={(e) => set('archived', e.target.value)}><option value="">Active only</option><option value="include">Include archived</option><option value="only">Archived only</option></Select>
          {isAdmin && <Select aria-label="Data type" value={f.demo} onChange={(e) => set('demo', e.target.value)}><option value="">Demo + real</option><option value="false">Real only</option><option value="true">Demo only</option></Select>}
        </div>
      </Card>

      {isAdmin && selected.size > 0 && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 border-brand-300 bg-brand-50 p-3 dark:bg-brand-950/30">
          <strong className="text-sm">{selected.size} selected</strong>
          <Select aria-label="Assign to" className="w-48" defaultValue="" onChange={(e) => { if (e.target.value) void bulk({ action: 'assign', ownerId: e.target.value === 'none' ? null : e.target.value }, 'Owner updated'); e.target.value = ''; }}><option value="">Assign to…</option><option value="none">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          <Select aria-label="Move to stage" className="w-48" defaultValue="" onChange={(e) => { if (e.target.value) void bulk({ action: 'stage', stageId: e.target.value }, 'Stage updated'); e.target.value = ''; }}><option value="">Move to stage…</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Button onClick={() => void bulk({ action: 'archive' }, 'Archived')}>Archive</Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <Card className="[&>div]:p-0">
        {error ? <div className="p-4"><ErrorBox error={error} onRetry={() => void mutate()} /></div> : isLoading || !data ? <Spinner /> : rows.length === 0 ? (
          <EmptyState title="No customers found" action={isAdmin ? <Link href="/import"><Button variant="primary">Import a spreadsheet</Button></Link> : undefined}>Adjust the filters{isAdmin ? ', add a customer, or import a CSV/Excel file.' : '. Customers appear here once an administrator assigns them to you.'}</EmptyState>
        ) : (
          <div className="p-2">
            <Table>
              <THead>
                {isAdmin && <th className="th w-8"><input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
                <th className="th">Customer</th><th className="th">Contact</th><th className="th">Stage</th><th className="th">Voice consent</th><th className="th">Last outcome</th><th className="th">Score</th><th className="th">Owner</th>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.archivedAt ? 'opacity-60' : ''}>
                    {isAdmin && <td className="td"><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => { const n = new Set(selected); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); setSelected(n); }} /></td>}
                    <td className="td"><Link href={`/customers/${r.id}`} className="font-medium hover:underline">{r.name}</Link> {r.isDemo && <DemoBadge className="ml-1" />}{r.doNotCall && <Badge tone="red" className="ml-1">DNC</Badge>}{r.archivedAt && <Badge className="ml-1">Archived</Badge>}<div className="muted text-xs">{r.company ?? ''}</div></td>
                    <td className="td text-xs"><div>{r.phone ?? '—'}</div><div className="muted">{r.email ?? ''}</div></td>
                    <td className="td">{r.stageName ?? '—'}</td>
                    <td className="td"><ConsentBadge status={r.voiceConsent} /></td>
                    <td className="td">{r.lastOutcome ? <Badge tone={OUTCOME_TONE[r.lastOutcome] ?? 'neutral'}>{OUTCOME_LABEL[r.lastOutcome]}</Badge> : '—'}<div className="muted text-xs">{fmtDate(r.lastContactedAt, { time: false })}</div></td>
                    <td className="td tabular-nums">{r.leadScore ?? '—'}</td>
                    <td className="td">{r.ownerName ?? <span className="muted">Unassigned</span>}</td>
                  </tr>
                ))}
              </TBody>
            </Table>
            <div className="px-2 pb-2"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} /></div>
          </div>
        )}
      </Card>
      <CreateCustomer open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void mutate(); }} />
    </>
  );
}

function CreateCustomer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const users = useUsers().data?.users ?? [];
  const empty = { name: '', company: '', phone: '', email: '', country: '', productInterest: '', ownerId: '' };
  const [f, setF] = useState(empty);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true); setError(null);
    try {
      await api('/api/customers', { body: { ...f, ownerId: f.ownerId || null, company: f.company || null, phone: f.phone || null, email: f.email || null, country: f.country || null, productInterest: f.productInterest || null } });
      toast.ok('Customer added. No consent is recorded until you add it on the customer page.'); setF(empty); onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  const fe = error instanceof ApiClientError ? error.fieldErrors : undefined;
  return (
    <Modal open={open} onClose={onClose} title="Add customer" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!f.name}>Add customer</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={fe?.name} className="sm:col-span-2">{(id) => <Input id={id} value={f.name} onChange={set('name')} required />}</Field>
        <Field label="Company">{(id) => <Input id={id} value={f.company} onChange={set('company')} />}</Field>
        <Field label="Product of interest">{(id) => <Input id={id} value={f.productInterest} onChange={set('productInterest')} />}</Field>
        <Field label="Phone" hint="Include the country code, e.g. +91…" error={fe?.phone}>{(id) => <Input id={id} value={f.phone} onChange={set('phone')} inputMode="tel" />}</Field>
        <Field label="Email" error={fe?.email}>{(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} />}</Field>
        <Field label="Country (ISO code)" hint="Required for compliance checks, e.g. IN">{(id) => <Input id={id} value={f.country} maxLength={2} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} />}</Field>
        <Field label="Owner">{(id) => <Select id={id} value={f.ownerId} onChange={set('ownerId')}><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}</Field>
      </div>
      {!!error && !fe && <div className="mt-3"><ErrorBox error={error} /></div>}
      {!!error && !!fe && <div className="mt-3"><ErrorBox error={new Error(Object.values(fe).flat()[0])} /></div>}
      <p className="muted mt-3 text-xs">Adding a customer does not record consent. Capture consent separately with its source.</p>
    </Modal>
  );
}
