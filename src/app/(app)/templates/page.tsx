'use client';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useToast } from '@/components/toast';
import { useMe } from '@/components/AppShell';
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, Notice, PageHeader, Select, Spinner, Table, TBody, THead, Textarea } from '@/components/ui';
import { api, ApiClientError, useApi } from '@/lib/client/fetcher';
import { label } from '@/lib/client/format';

type Tpl = {
  id: string; name: string; channel: 'SMS' | 'EMAIL' | 'WHATSAPP'; subject: string | null; bodyText: string; bodyHtml: string | null; language: string; isMarketing: boolean; approved: boolean; active: boolean;
  providerTemplateId: string | null; dltTemplateId: string | null; dltEntityId: string | null; variables: string[];
};

export default function TemplatesPage() {
  const { data, error, mutate } = useApi<{ templates: Tpl[] }>('/api/templates');
  const { isAdmin } = useMe();
  const [edit, setEdit] = useState<Tpl | 'new' | null>(null);
  return (
    <>
      <PageHeader title="Message templates" description="Reusable SMS, email and WhatsApp messages. A template must be marked approved by an administrator before the system will send it — editing the wording removes the approval."
        actions={isAdmin && <Button variant="primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />New template</Button>} />
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : data.templates.length === 0 ? (
        <Card><EmptyState title="No templates yet" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead><th>Name</th><th>Channel</th><th>Type</th><th>Approval</th><th>Variables</th><th /></THead>
            <TBody>{data.templates.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.name}{!t.active && <Badge className="ml-2">Inactive</Badge>}</td>
                <td>{label(t.channel)}</td>
                <td>{t.isMarketing ? 'Marketing' : 'Transactional'}</td>
                <td><Badge tone={t.approved ? 'green' : 'amber'}>{t.approved ? 'Approved' : 'Not approved'}</Badge></td>
                <td className="muted text-xs">{t.variables.join(', ') || '—'}</td>
                <td className="text-right">{isAdmin ? <Button size="sm" onClick={() => setEdit(t)}>Edit</Button> : <Button size="sm" onClick={() => setEdit(t)}>View</Button>}</td>
              </tr>))}</TBody>
          </Table>
        </Card>
      )}
      {edit && <TemplateEditor tpl={edit === 'new' ? null : edit} readOnly={!isAdmin} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void mutate(); }} />}
    </>
  );
}

function TemplateEditor({ tpl, readOnly, onClose, onSaved }: { tpl: Tpl | null; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: tpl?.name ?? '', channel: tpl?.channel ?? 'EMAIL', subject: tpl?.subject ?? '', bodyText: tpl?.bodyText ?? '', language: tpl?.language ?? 'en', isMarketing: tpl?.isMarketing ?? true,
    providerTemplateId: tpl?.providerTemplateId ?? '', dltTemplateId: tpl?.dltTemplateId ?? '', dltEntityId: tpl?.dltEntityId ?? '', active: tpl?.active ?? true,
  });
  const [approved, setApproved] = useState(tpl?.approved ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [del, setDel] = useState(false);
  const [prev, setPrev] = useState<{ subject: string | null; text: string; unknownVariables: string[] } | null>(null);
  const fe = error instanceof ApiClientError ? error.fieldErrors : undefined;
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ subject: string | null; text: string; unknownVariables: string[] }>('/api/templates/preview', { body: { subject: f.subject || null, bodyText: f.bodyText || ' ' } }).then(setPrev).catch(() => setPrev(null));
    }, 400);
    return () => clearTimeout(t);
  }, [f.subject, f.bodyText]);

  async function save() {
    setBusy(true); setError(null);
    const nz = (s: string) => s.trim() || null;
    const body = { ...f, subject: f.channel === 'EMAIL' ? nz(f.subject) : null, providerTemplateId: nz(f.providerTemplateId), dltTemplateId: nz(f.dltTemplateId), dltEntityId: nz(f.dltEntityId) };
    try {
      if (tpl) await api(`/api/templates/${tpl.id}`, { method: 'PATCH', body: { ...body, approved } }); else await api('/api/templates', { body });
      toast.ok(tpl ? 'Template saved' : 'Template created — remember to mark it approved once the provider/DLT approval exists'); onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function remove() { try { await api(`/api/templates/${tpl!.id}`, { method: 'DELETE' }); toast.ok('Template deleted'); onSaved(); } catch (e) { toast.error((e as Error).message); setDel(false); } }

  return (
    <Modal wide open onClose={onClose} title={tpl ? (readOnly ? tpl.name : `Edit ${tpl.name}`) : 'New template'}
      footer={<>{tpl && !readOnly && <Button variant="danger" className="mr-auto" onClick={() => setDel(true)}>Delete</Button>}<Button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>{!readOnly && <Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button>}</>}>
      <fieldset disabled={readOnly} className="space-y-4">
        {!!error && <ErrorBox error={error} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" error={fe?.name}>{(i) => <Input id={i} value={f.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <Field label="Channel">{(i) => <Select id={i} value={f.channel} onChange={(e) => set('channel', e.target.value as Tpl['channel'])} disabled={!!tpl}><option value="EMAIL">Email</option><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option></Select>}</Field>
          <Field label="Language">{(i) => <Input id={i} value={f.language} onChange={(e) => set('language', e.target.value)} />}</Field>
        </div>
        {f.channel === 'EMAIL' && <Field label="Subject" error={fe?.subject}>{(i) => <Input id={i} value={f.subject} onChange={(e) => set('subject', e.target.value)} />}</Field>}
        <Field label="Message" hint="Variables: {{first_name}}, {{name}}, {{company}}, {{product}}, {{company_name}}, {{agent_name}}, {{unsubscribe_url}}" error={fe?.bodyText}>{(i) => <Textarea id={i} rows={7} value={f.bodyText} onChange={(e) => set('bodyText', e.target.value)} />}</Field>
        {prev && (
          <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface-2))] p-3 text-sm">
            <p className="muted mb-1 text-xs font-medium uppercase">Preview with sample data</p>
            {prev.subject && <p className="font-medium">{prev.subject}</p>}
            <p className="whitespace-pre-wrap">{prev.text}</p>
            {prev.unknownVariables.length > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Unknown variables (will be sent blank): {prev.unknownVariables.join(', ')}</p>}
          </div>
        )}
        <Checkbox label="Marketing / promotional message (needs opt-in consent and, for email, an unsubscribe link)" checked={f.isMarketing} onChange={(e) => set('isMarketing', e.target.checked)} />
        {f.channel === 'WHATSAPP' && <Field label="Meta-approved template name" error={fe?.providerTemplateId}>{(i) => <Input id={i} value={f.providerTemplateId} onChange={(e) => set('providerTemplateId', e.target.value)} />}</Field>}
        {f.channel === 'SMS' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="DLT template ID (India)">{(i) => <Input id={i} value={f.dltTemplateId} onChange={(e) => set('dltTemplateId', e.target.value)} />}</Field>
            <Field label="DLT entity ID (India)">{(i) => <Input id={i} value={f.dltEntityId} onChange={(e) => set('dltEntityId', e.target.value)} />}</Field>
          </div>
        )}
        <div className="space-y-2 rounded-lg border border-[rgb(var(--border))] p-3">
          <Checkbox label="I attest this exact wording is approved for sending (provider/DLT registration complete)" checked={approved} onChange={(e) => setApproved(e.target.checked)} disabled={!tpl} />
          {!tpl && <p className="muted text-xs">Save the template first, then attest approval.</p>}
          <Notice tone="blue">Changing the wording of an approved template removes its approval unless you re-attest here in the same save.</Notice>
        </div>
        <Checkbox label="Active" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
      </fieldset>
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => void remove()} danger title="Delete template" confirmLabel="Delete"><p>Follow-up rules that use this template are switched off.</p></ConfirmDialog>
    </Modal>
  );
}
