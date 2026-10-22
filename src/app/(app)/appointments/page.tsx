'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, TBody, THead, Textarea } from '@/components/ui';
import { api, ApiClientError, qs, useApi } from '@/lib/client/fetcher';
import { fmtDate, label } from '@/lib/client/format';

type Appt = { id: string; customerId: string; customerName: string; company: string | null; ownerName: string | null; title: string; status: string; startsAt: string | null; endsAt: string | null; location: string | null; notes: string | null; requestedWindow: string | null; isDemo: boolean };
const TONE = { REQUESTED: 'amber', SCHEDULED: 'blue', COMPLETED: 'green', CANCELED: 'neutral', NO_SHOW: 'red' } as const;
const toLocalInput = (v: string | null) => (v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export default function AppointmentsPage() {
  const [status, setStatus] = useState('');
  const { data, error, mutate } = useApi<{ appointments: Appt[] }>(`/api/appointments${qs({ status })}`);
  const [edit, setEdit] = useState<Appt | 'new' | null>(null);
  return (
    <>
      <PageHeader title="Appointments" description="Meetings requested by customers on calls and those you schedule. A requested time is only a preference until someone confirms it."
        actions={<Button variant="primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />New appointment</Button>} />
      <div className="mb-4"><Select aria-label="Status" className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.keys(TONE).map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></div>
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : data.appointments.length === 0 ? <Card><EmptyState title="No appointments" /></Card> : (
        <Card className="overflow-hidden">
          <Table>
            <THead><th>When</th><th>Customer</th><th>Title</th><th>Status</th><th>Owner</th><th /></THead>
            <TBody>{data.appointments.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">{a.startsAt ? fmtDate(a.startsAt) : <span className="muted">{a.requestedWindow ? `Asked: ${a.requestedWindow}` : 'Not scheduled'}</span>}</td>
                <td><Link className="text-brand-700 hover:underline dark:text-brand-300" href={`/customers/${a.customerId}`}>{a.customerName}</Link> {a.isDemo && <DemoBadge />}<div className="muted text-xs">{a.company}</div></td>
                <td>{a.title}</td>
                <td><Badge tone={TONE[a.status as keyof typeof TONE] ?? 'neutral'}>{label(a.status)}</Badge></td>
                <td>{a.ownerName ?? '—'}</td>
                <td className="text-right"><Button size="sm" onClick={() => setEdit(a)}>Edit</Button></td>
              </tr>))}</TBody>
          </Table>
        </Card>
      )}
      {edit && <ApptEditor appt={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void mutate(); }} />}
    </>
  );
}

function ApptEditor({ appt, onClose, onSaved }: { appt: Appt | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [customerQ, setCustomerQ] = useState('');
  const [customerId, setCustomerId] = useState(appt?.customerId ?? '');
  const found = useApi<{ customers: { id: string; name: string; company: string | null }[] }>(!appt && customerQ.length >= 2 ? `/api/customers${qs({ q: customerQ, pageSize: 8 })}` : null);
  const [f, setF] = useState({ title: appt?.title ?? '', startsAt: toLocalInput(appt?.startsAt ?? null), endsAt: toLocalInput(appt?.endsAt ?? null), location: appt?.location ?? '', notes: appt?.notes ?? '', status: appt?.status ?? 'SCHEDULED' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fe = error instanceof ApiClientError ? error.fieldErrors : undefined;
  async function save() {
    setBusy(true); setError(null);
    const body = { title: f.title, startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null, location: f.location || null, notes: f.notes || null };
    try {
      if (appt) await api(`/api/appointments/${appt.id}`, { method: 'PATCH', body: { ...body, status: f.status } });
      else { if (!customerId) throw new Error('Choose a customer'); await api('/api/appointments', { body: { ...body, customerId } }); }
      toast.ok('Appointment saved'); onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={appt ? 'Edit appointment' : 'New appointment'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="space-y-3">
        {!!error && <ErrorBox error={error} />}
        {!appt && (
          <Field label="Customer" hint={customerId ? 'Customer selected' : 'Type at least 2 letters to search'}>{(i) => (
            <>
              <Input id={i} value={customerQ} onChange={(e) => { setCustomerQ(e.target.value); setCustomerId(''); }} />
              {!customerId && found.data?.customers.length ? <ul className="mt-1 divide-y divide-[rgb(var(--border))] rounded-lg border border-[rgb(var(--border))] text-sm">{found.data.customers.map((c) => <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-[rgb(var(--surface-2))]" onClick={() => { setCustomerId(c.id); setCustomerQ(c.name); }}>{c.name}<span className="muted"> {c.company}</span></button></li>)}</ul> : null}
            </>)}</Field>
        )}
        <Field label="Title" error={fe?.title}>{(i) => <Input id={i} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts">{(i) => <Input id={i} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />}</Field>
          <Field label="Ends" error={fe?.endsAt}>{(i) => <Input id={i} type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />}</Field>
        </div>
        <Field label="Location / link">{(i) => <Input id={i} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />}</Field>
        {appt && <Field label="Status">{(i) => <Select id={i} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.keys(TONE).map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</Field>}
        <Field label="Notes">{(i) => <Textarea id={i} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}
