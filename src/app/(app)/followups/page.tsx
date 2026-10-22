'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useMe } from '@/components/AppShell';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DemoBadge, EmptyState, ErrorBox, Field, Input, Modal, Notice, PageHeader, Pagination, Select, Spinner, Table, Tabs, TBody, THead } from '@/components/ui';
import { api, ApiClientError, qs, useApi } from '@/lib/client/fetcher';
import { fmtDate, label, OUTCOME_LABEL, type Tone } from '@/lib/client/format';

type Task = { id: string; customerId: string; customerName: string; type: string; status: string; title: string | null; scheduledFor: string; lastError: string | null; assigneeName: string | null; attempts: number; maxAttempts: number; isDemo: boolean };
type Rule = { id: string; name: string; campaignId: string | null; outcome: string; action: string; templateId: string | null; delayMinutes: number; active: boolean };
type Tpl = { id: string; name: string; channel: string; approved: boolean };
const ACTIONS = ['SEND_EMAIL', 'SEND_SMS', 'SEND_WHATSAPP', 'CREATE_APPOINTMENT', 'SCHEDULE_CALLBACK', 'ASSIGN_HUMAN', 'TASK'];
const TONE: Record<string, Tone> = { PENDING: 'amber', PROCESSING: 'blue', COMPLETED: 'green', FAILED: 'red', CANCELED: 'neutral', SKIPPED: 'neutral' };
const PAGE = 25;

export default function FollowUpsPage() {
  const { isAdmin } = useMe();
  const [tab, setTab] = useState<'tasks' | 'rules'>('tasks');
  return (
    <>
      <PageHeader title="Follow-up automation" description="After each analysed call, rules decide what happens next: send a message, book a meeting, schedule a callback or hand the lead to a person. Every message still passes the compliance checks when it is sent." />
      <Tabs tabs={isAdmin ? [{ id: 'tasks', label: 'Tasks' }, { id: 'rules', label: 'Rules' }] : [{ id: 'tasks', label: 'Tasks' }]} value={tab} onChange={setTab} />
      {tab === 'tasks' ? <Tasks isAdmin={isAdmin} /> : <Rules />}
    </>
  );
}

function Tasks({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const { data, error, mutate } = useApi<{ tasks: Task[]; total: number }>(`/api/followups/tasks${qs({ page, pageSize: PAGE, status, assignedToMe: mine ? 'true' : undefined })}`, { keepPreviousData: true });
  async function setTask(id: string, s: 'COMPLETED' | 'CANCELED' | 'PENDING') {
    try { await api(`/api/followups/tasks/${id}`, { method: 'PATCH', body: { status: s } }); await mutate(); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select aria-label="Status" className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option>{Object.keys(TONE).map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        {isAdmin && <Checkbox label="Assigned to me" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} />}
      </div>
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : data.tasks.length === 0 ? <Card><EmptyState title="No follow-up tasks" /></Card> : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <THead><th>Due</th><th>Customer</th><th>Task</th><th>Status</th><th>Assigned</th><th /></THead>
              <TBody>{data.tasks.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">{fmtDate(t.scheduledFor)}</td>
                  <td><Link className="text-brand-700 hover:underline dark:text-brand-300" href={`/customers/${t.customerId}`}>{t.customerName}</Link> {t.isDemo && <DemoBadge />}</td>
                  <td>{t.title ?? label(t.type)}<div className="muted text-xs">{label(t.type)}{t.attempts > 0 && ` · try ${t.attempts}/${t.maxAttempts}`}</div>{t.lastError && <div className="text-xs text-red-600">{t.lastError}</div>}</td>
                  <td><Badge tone={TONE[t.status] ?? 'neutral'}>{label(t.status)}</Badge></td>
                  <td>{t.assigneeName ?? '—'}</td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    {['TASK', 'ASSIGN_HUMAN'].includes(t.type) && t.status === 'PENDING' && <Button size="sm" onClick={() => void setTask(t.id, 'COMPLETED')}>Done</Button>}
                    {t.status === 'PENDING' && <Button size="sm" variant="ghost" onClick={() => void setTask(t.id, 'CANCELED')}>Cancel</Button>}
                  </td>
                </tr>))}</TBody>
            </Table>
          </Card>
          <Pagination page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

function Rules() {
  const { data, error, mutate } = useApi<{ rules: Rule[] }>('/api/followups/rules');
  const templates = useApi<{ templates: Tpl[] }>('/api/templates');
  const [edit, setEdit] = useState<Rule | 'new' | null>(null);
  const tName = (id: string | null) => templates.data?.templates.find((t) => t.id === id);
  return (
    <>
      <div className="mb-4 flex justify-end"><Button variant="primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />New rule</Button></div>
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : data.rules.length === 0 ? <Card><EmptyState title="No rules">Without rules, calls are analysed but nothing happens afterwards.</EmptyState></Card> : (
        <Card className="overflow-hidden">
          <Table>
            <THead><th>Rule</th><th>When outcome is</th><th>Then</th><th>After</th><th>State</th><th /></THead>
            <TBody>{data.rules.map((r) => {
              const t = tName(r.templateId);
              return (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}{r.campaignId && <div className="muted text-xs">campaign-specific</div>}</td>
                  <td>{OUTCOME_LABEL[r.outcome] ?? label(r.outcome)}</td>
                  <td>{label(r.action)}{t && <div className="muted text-xs">{t.name}{!t.approved && <span className="text-amber-700"> · template not approved</span>}</div>}</td>
                  <td>{r.delayMinutes ? `${r.delayMinutes} min` : 'immediately'}</td>
                  <td><Badge tone={r.active ? 'green' : 'neutral'}>{r.active ? 'Active' : 'Off'}</Badge></td>
                  <td className="text-right"><Button size="sm" onClick={() => setEdit(r)}>Edit</Button></td>
                </tr>);
            })}</TBody>
          </Table>
        </Card>
      )}
      {edit && <RuleEditor rule={edit === 'new' ? null : edit} templates={templates.data?.templates ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void mutate(); }} />}
    </>
  );
}

function RuleEditor({ rule, templates, onClose, onSaved }: { rule: Rule | null; templates: Tpl[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const campaigns = useApi<{ campaigns: { id: string; name: string }[] }>('/api/campaigns');
  const [f, setF] = useState({ name: rule?.name ?? '', outcome: rule?.outcome ?? 'INTERESTED', action: rule?.action ?? 'SEND_EMAIL', templateId: rule?.templateId ?? '', campaignId: rule?.campaignId ?? '', delayMinutes: rule?.delayMinutes ?? 0, active: rule?.active ?? true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [del, setDel] = useState(false);
  const fe = error instanceof ApiClientError ? error.fieldErrors : undefined;
  const channel = ({ SEND_EMAIL: 'EMAIL', SEND_SMS: 'SMS', SEND_WHATSAPP: 'WHATSAPP' } as Record<string, string>)[f.action];
  async function save() {
    setBusy(true); setError(null);
    const body = { ...f, templateId: channel ? f.templateId || null : null, campaignId: f.campaignId || null };
    try { if (rule) await api(`/api/followups/rules/${rule.id}`, { method: 'PATCH', body }); else await api('/api/followups/rules', { body }); toast.ok('Rule saved'); onSaved(); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function remove() { try { await api(`/api/followups/rules/${rule!.id}`, { method: 'DELETE' }); onSaved(); } catch (e) { toast.error((e as Error).message); setDel(false); } }
  return (
    <Modal open onClose={onClose} title={rule ? 'Edit rule' : 'New rule'} footer={<>{rule && <Button variant="danger" className="mr-auto" onClick={() => setDel(true)}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="space-y-3">
        {!!error && <ErrorBox error={error} />}
        <Field label="Rule name" error={fe?.name}>{(i) => <Input id={i} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="When the call outcome is">{(i) => <Select id={i} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>{Object.entries(OUTCOME_LABEL).filter(([k]) => k !== 'PENDING_ANALYSIS').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Do this">{(i) => <Select id={i} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value, templateId: '' })}>{ACTIONS.map((a) => <option key={a} value={a}>{label(a)}</option>)}</Select>}</Field>
        </div>
        {channel && <Field label="Template" hint="Only approved templates are actually sent.">{(i) => <Select id={i} value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}><option value="">Choose…</option>{templates.filter((t) => t.channel === channel).map((t) => <option key={t.id} value={t.id}>{t.name}{t.approved ? '' : ' (not approved)'}</option>)}</Select>}</Field>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Delay (minutes)" error={fe?.delayMinutes}>{(i) => <Input id={i} type="number" min={0} value={f.delayMinutes} onChange={(e) => setF({ ...f, delayMinutes: Number(e.target.value) })} />}</Field>
          <Field label="Applies to" hint="Campaign rules replace global rules for that outcome.">{(i) => <Select id={i} value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })}><option value="">All campaigns</option>{campaigns.data?.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        </div>
        <Checkbox label="Rule is active" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        <Notice tone="blue">Consent and opt-outs are checked again when a message is sent, so a rule can never override a customer’s refusal.</Notice>
      </div>
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => void remove()} danger title="Delete rule" confirmLabel="Delete"><p>Tasks already created by this rule are kept.</p></ConfirmDialog>
    </Modal>
  );
}
