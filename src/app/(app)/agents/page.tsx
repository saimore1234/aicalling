'use client';
import { useState } from 'react';
import { Bot, Plus, Eye } from 'lucide-react';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, Notice, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { api, ApiClientError, useApi } from '@/lib/client/fetcher';
import { STARTER_AGENT } from '@/server/agent-validation';

type Problem = { field: string; message: string; severity: 'error' | 'warning' };
type Agent = typeof STARTER_AGENT & { id: string; transcriptEnabled: boolean; active: boolean; humanTransferNumber: string | null; analysisModel: string; problems: Problem[]; launchable: boolean };
type FormState = Omit<Agent, 'id' | 'problems' | 'launchable' | 'voiceProvider'>;

const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const LANGS = [['en', 'English'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['ar', 'Arabic'], ['ta', 'Tamil'], ['bn', 'Bengali'], ['mr', 'Marathi'], ['gu', 'Gujarati']];

export default function AgentsPage() {
  const { data, error, mutate } = useApi<{ agents: Agent[] }>('/api/agents');
  const [editing, setEditing] = useState<Agent | 'new' | null>(null);
  return (
    <>
      <PageHeader title="AI agents" description="An agent defines who calls, what it may say, and when it hands over to a human. The agent only speaks from the approved information you provide here."
        actions={<Button variant="primary" onClick={() => setEditing('new')}><Plus className="h-4 w-4" />New agent</Button>} />
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : data.agents.length === 0 ? (
        <Card><EmptyState title="No AI agents yet" action={<Button variant="primary" onClick={() => setEditing('new')}>Create your first agent</Button>}>Campaigns cannot start until an agent passes validation: it must disclose that it is an AI, name your company, and have approved product knowledge.</EmptyState></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.agents.map((a) => (
            <Card key={a.id} title={<span className="flex items-center gap-2"><Bot className="h-4 w-4" />{a.name}</span>} actions={<Badge tone={a.launchable ? 'green' : 'amber'}>{a.launchable ? 'Ready' : 'Needs attention'}</Badge>}>
              <p className="muted text-sm">{a.companyName} · {LANGS.find((l) => l[0] === a.language)?.[1] ?? a.language} · voice {a.voiceId} · max {Math.round(a.maxCallSeconds / 60 * 10) / 10} min</p>
              <p className="mt-2 line-clamp-2 text-sm italic">“{a.greeting}”</p>
              {a.problems.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs">{a.problems.map((p, i) => <li key={i} className={p.severity === 'error' ? 'text-red-600' : 'text-amber-700 dark:text-amber-400'}>{p.severity === 'error' ? '✕' : '⚠'} {p.message}</li>)}</ul>
              )}
              <div className="mt-4 flex gap-2"><Button size="sm" onClick={() => setEditing(a)}>Edit</Button>{!a.active && <Badge>Inactive</Badge>}</div>
            </Card>
          ))}
        </div>
      )}
      {editing && <AgentEditor agent={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </>
  );
}

function toForm(a: Agent | null): FormState {
  if (!a) return { ...STARTER_AGENT, analysisModel: 'gpt-4.1-mini', humanTransferNumber: null, transcriptEnabled: true, active: true };
  const { id: _i, problems: _p, launchable: _l, voiceProvider: _v, ...rest } = a;
  return rest;
}

function AgentEditor({ agent, onClose, onSaved }: { agent: Agent | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<FormState>(toForm(agent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState<{ greeting: string; instructions: string } | null>(null);
  const [del, setDel] = useState(false);
  const fe = error instanceof ApiClientError ? error.fieldErrors : undefined;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const txt = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k, e.target.value as never);

  async function save() {
    setBusy(true); setError(null);
    try {
      const body = { ...f, humanTransferNumber: f.humanTransferNumber || null };
      if (agent) await api(`/api/agents/${agent.id}`, { method: 'PATCH', body }); else await api('/api/agents', { body });
      toast.ok('Agent saved'); onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function showPreview() {
    if (!agent) { toast.error('Save the agent first to preview its prompt.'); return; }
    try { setPreview(await api(`/api/agents/${agent.id}/preview-prompt`)); } catch (e) { toast.error((e as Error).message); }
  }
  async function remove() {
    try { await api(`/api/agents/${agent!.id}`, { method: 'DELETE' }); toast.ok('Agent deleted'); onSaved(); } catch (e) { toast.error((e as Error).message); setDel(false); }
  }

  return (
    <Modal wide open onClose={onClose} title={agent ? `Edit ${agent.name}` : 'New AI agent'}
      footer={<>{agent && <Button variant="danger" className="mr-auto" onClick={() => setDel(true)}>Delete</Button>}{agent && <Button onClick={() => void showPreview()}><Eye className="h-4 w-4" />Preview prompt</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save agent</Button></>}>
      <div className="space-y-6">
        {!!error && <ErrorBox error={fe ? new Error(Object.entries(fe).map(([k, v]) => `${k}: ${v[0]}`).join(' · ')) : error} />}
        <Section title="Identity">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Agent name" hint="Internal label, and how the agent introduces itself">{(i) => <Input id={i} value={f.name} onChange={txt('name')} />}</Field>
            <Field label="Company name" hint="The real company the agent calls on behalf of">{(i) => <Input id={i} value={f.companyName} onChange={txt('companyName')} placeholder="e.g. Acme Solar Pvt Ltd" />}</Field>
            <Field label="Language">{(i) => <Select id={i} value={f.language} onChange={txt('language')}>{LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select>}</Field>
            <Field label="Voice">{(i) => <Select id={i} value={f.voiceId} onChange={txt('voiceId')}>{VOICES.map((v) => <option key={v} value={v}>{v}</option>)}</Select>}</Field>
            <Field label="Real-time model">{(i) => <Input id={i} value={f.model} onChange={txt('model')} />}</Field>
            <Field label="Call analysis model">{(i) => <Input id={i} value={f.analysisModel} onChange={txt('analysisModel')} />}</Field>
          </div>
        </Section>
        <Section title="Opening line">
          <Field label="Greeting" hint="Must clearly say the caller is an AI assistant. Placeholders: {{company}}, {{first_name}}.">{(i) => <Textarea id={i} rows={3} value={f.greeting} onChange={txt('greeting')} />}</Field>
          <Checkbox label="Tell customers the call may be transcribed (recommended; transcripts are stored)" checked={f.transcriptEnabled} onChange={(e) => set('transcriptEnabled', e.target.checked)} />
        </Section>
        <Section title="What the agent may say">
          <Notice tone="blue">The agent is instructed to use <strong>only</strong> the information below and to hand over to a human for anything else. Do not paste unverified claims.</Notice>
          <Field label="Approved product knowledge" error={fe?.productKnowledge}>{(i) => <Textarea id={i} rows={6} value={f.productKnowledge} onChange={txt('productKnowledge')} placeholder="Describe your products, services, and the facts the agent may state." />}</Field>
          <ListEditor label="Frequently asked questions" value={f.faq} onChange={(v) => set('faq', v)} blank={{ question: '', answer: '' }} render={(item, upd) => <><Input aria-label="Question" placeholder="Question" value={item.question} onChange={(e) => upd({ ...item, question: e.target.value })} /><Textarea aria-label="Answer" rows={2} placeholder="Approved answer" value={item.answer} onChange={(e) => upd({ ...item, answer: e.target.value })} /></>} />
          <ListEditor label="Approved pricing" value={f.pricing} onChange={(v) => set('pricing', v)} blank={{ item: '', price: '', currency: '', note: '' }} render={(item, upd) => <div className="grid gap-2 sm:grid-cols-4"><Input aria-label="Item" placeholder="Item / plan" value={item.item} onChange={(e) => upd({ ...item, item: e.target.value })} /><Input aria-label="Price" placeholder="Price" value={item.price} onChange={(e) => upd({ ...item, price: e.target.value })} /><Input aria-label="Currency" placeholder="Currency" value={item.currency ?? ''} onChange={(e) => upd({ ...item, currency: e.target.value })} /><Input aria-label="Note" placeholder="Note (e.g. per month)" value={item.note ?? ''} onChange={(e) => upd({ ...item, note: e.target.value })} /></div>} />
          <Field label="Permitted claims">{(i) => <Textarea id={i} rows={2} value={f.permittedClaims} onChange={txt('permittedClaims')} />}</Field>
          <Field label="Restricted actions">{(i) => <Textarea id={i} rows={2} value={f.restrictedActions} onChange={txt('restrictedActions')} />}</Field>
        </Section>
        <Section title="Conversation">
          <Field label="Objective">{(i) => <Textarea id={i} rows={2} value={f.salesObjectives} onChange={txt('salesObjectives')} />}</Field>
          <Field label="Sales script (guidance)">{(i) => <Textarea id={i} rows={4} value={f.salesScript} onChange={txt('salesScript')} />}</Field>
          <Field label="Qualification questions" hint="One per line">{(i) => <Textarea id={i} rows={3} value={f.qualificationQuestions.join('\n')} onChange={(e) => set('qualificationQuestions', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} />}</Field>
          <Field label="Objection handling">{(i) => <Textarea id={i} rows={3} value={f.objectionHandling} onChange={txt('objectionHandling')} />}</Field>
          <Field label="Response style">{(i) => <Input id={i} value={f.responseStyle} onChange={txt('responseStyle')} />}</Field>
        </Section>
        <Section title="Handover and limits">
          <Field label="When to hand over to a human" error={fe?.escalationRules}>{(i) => <Textarea id={i} rows={3} value={f.escalationRules} onChange={txt('escalationRules')} />}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Human transfer number (optional)" hint="E.164, e.g. +919800000000. Without it, a follow-up task is created instead of a live transfer." error={fe?.humanTransferNumber}>{(i) => <Input id={i} value={f.humanTransferNumber ?? ''} onChange={(e) => set('humanTransferNumber', e.target.value)} />}</Field>
            <Field label="Maximum call length (seconds)" hint="30 – 1800. The call is ended at this limit." error={fe?.maxCallSeconds}>{(i) => <Input id={i} type="number" min={30} max={1800} value={f.maxCallSeconds} onChange={(e) => set('maxCallSeconds', Number(e.target.value))} />}</Field>
          </div>
          <Field label="Callback policy">{(i) => <Textarea id={i} rows={2} value={f.callbackPolicy} onChange={txt('callbackPolicy')} />}</Field>
          <Field label="If the customer is interested">{(i) => <Textarea id={i} rows={2} value={f.followUpInstructions} onChange={txt('followUpInstructions')} />}</Field>
          <Checkbox label="Agent is active" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
        </Section>
      </div>
      <Modal open={!!preview} onClose={() => setPreview(null)} title="Exactly what the model is told" wide>
        <p className="mb-2 text-sm"><strong>Opening line:</strong> “{preview?.greeting}”</p>
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--surface-2))] p-3 text-xs">{preview?.instructions}</pre>
      </Modal>
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => void remove()} danger title="Delete agent" confirmLabel="Delete"><p>Past calls keep their history. Campaigns using this agent must be stopped first.</p></ConfirmDialog>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3"><h3 className="border-b border-[rgb(var(--border))] pb-1 text-sm font-semibold">{title}</h3>{children}</section>;
}
function ListEditor<T>({ label, value, onChange, blank, render }: { label: string; value: T[]; onChange: (v: T[]) => void; blank: T; render: (item: T, update: (n: T) => void) => React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between"><span className="text-sm font-medium">{label}</span><Button size="sm" onClick={() => onChange([...value, { ...blank }])}><Plus className="h-3.5 w-3.5" />Add</Button></div>
      <ul className="space-y-2">{value.map((item, i) => (
        <li key={i} className="space-y-2 rounded-lg border border-[rgb(var(--border))] p-2">
          {render(item, (n) => onChange(value.map((x, j) => (j === i ? n : x))))}
          <div className="text-right"><button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button></div>
        </li>
      ))}</ul>
    </div>
  );
}
