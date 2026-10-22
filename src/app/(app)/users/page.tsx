'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useMe } from '@/components/AppShell';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ConfirmDialog, ErrorBox, Field, Input, Modal, Notice, PageHeader, Select, Spinner, Table, TBody, THead } from '@/components/ui';
import { api, useApi } from '@/lib/client/fetcher';
import { fmtDate, label } from '@/lib/client/format';

type U = { id: string; email: string; name: string; role: 'ADMIN' | 'SALES_EXECUTIVE'; active: boolean; mustChangePassword: boolean; lastLoginAt: string | null };

export default function UsersPage() {
  const { me } = useMe();
  const toast = useToast();
  const { data, error, mutate } = useApi<{ users: U[] }>('/api/users');
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [del, setDel] = useState<U | null>(null);

  async function patch(u: U, body: Partial<Pick<U, 'role' | 'active'>>) {
    try { await api(`/api/users/${u.id}`, { method: 'PATCH', body }); toast.ok('User updated'); await mutate(); } catch (e) { toast.error((e as Error).message); }
  }
  async function resetLink(u: U) {
    try { const r = await api<{ link: string }>(`/api/users/${u.id}/reset-link`, { body: {} }); setLink({ name: u.name, url: r.link }); } catch (e) { toast.error((e as Error).message); }
  }
  async function remove() {
    try { await api(`/api/users/${del!.id}`, { method: 'DELETE' }); toast.ok('User removed'); setDel(null); await mutate(); } catch (e) { toast.error((e as Error).message); setDel(null); }
  }
  return (
    <>
      <PageHeader title="Users & roles" description="Administrators manage everything. Sales executives see only the customers assigned to them, their calls, follow-ups and appointments."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New user</Button>} />
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : (
        <Card className="overflow-hidden"><Table>
          <THead><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></THead>
          <TBody>{data.users.map((u) => (
            <tr key={u.id}>
              <td className="font-medium">{u.name}{u.id === me.id && <span className="muted font-normal"> (you)</span>}<div className="muted text-xs">{u.email}</div></td>
              <td><Select aria-label={`Role for ${u.name}`} className="w-44" value={u.role} disabled={u.id === me.id} onChange={(e) => void patch(u, { role: e.target.value as U['role'] })}><option value="ADMIN">Administrator</option><option value="SALES_EXECUTIVE">Sales executive</option></Select></td>
              <td><Badge tone={u.active ? 'green' : 'neutral'}>{u.active ? 'Active' : 'Disabled'}</Badge>{u.mustChangePassword && <Badge tone="amber" className="ml-1">Must change password</Badge>}</td>
              <td className="muted">{fmtDate(u.lastLoginAt)}</td>
              <td className="space-x-1 whitespace-nowrap text-right">
                <Button size="sm" onClick={() => void resetLink(u)}>Reset link</Button>
                {u.id !== me.id && <Button size="sm" onClick={() => void patch(u, { active: !u.active })}>{u.active ? 'Disable' : 'Enable'}</Button>}
                {u.id !== me.id && <Button size="sm" variant="ghost" onClick={() => setDel(u)}>Remove</Button>}
              </td>
            </tr>))}</TBody>
        </Table></Card>
      )}
      {creating && <NewUser onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void mutate(); }} />}
      <Modal open={!!link} onClose={() => setLink(null)} title={`Password reset link for ${link?.name ?? ''}`} footer={<Button onClick={() => setLink(null)}>Close</Button>}>
        <Notice tone="amber">Shown once. Send it to the user over a secure channel. It works a single time and expires in 30 minutes.</Notice>
        <input readOnly aria-label="Reset link" className="input mt-3 font-mono text-xs" value={link?.url ?? ''} onFocus={(e) => e.target.select()} />
        <Button className="mt-2" size="sm" onClick={() => { void navigator.clipboard?.writeText(link?.url ?? ''); toast.ok('Copied'); }}>Copy</Button>
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger confirmLabel="Remove user" title={`Remove ${del?.name ?? ''}`} onConfirm={() => void remove()}><p>Their sessions end immediately. Audit history and customer records are kept.</p></ConfirmDialog>
    </>
  );
}

function NewUser({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', role: 'SALES_EXECUTIVE', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setBusy(true); setError(null);
    try { await api('/api/users', { body: f }); toast.ok('User created — they must change the password at first sign-in'); onSaved(); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New user" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Create</Button></>}>
      <div className="space-y-3">
        {!!error && <ErrorBox error={error} />}
        <Field label="Full name">{(i) => <Input id={i} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Email">{(i) => <Input id={i} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Role">{(i) => <Select id={i} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="SALES_EXECUTIVE">{label('SALES_EXECUTIVE')}</option><option value="ADMIN">Administrator</option></Select>}</Field>
        <Field label="Temporary password" hint="12+ characters with upper, lower case and a number. The user must change it at first sign-in.">{(i) => <Input id={i} type="text" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}
