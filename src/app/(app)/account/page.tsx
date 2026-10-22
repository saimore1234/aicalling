'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorBox, Field, Input, Notice, PageHeader, Spinner } from '@/components/ui';
import { api, useApi } from '@/lib/client/fetcher';
import { fmtDate } from '@/lib/client/format';

type Sess = { id: string; ipAddress: string | null; userAgent: string | null; lastUsedAt: string; createdAt: string; current: boolean };

export default function AccountPage() {
  return <Suspense fallback={<Spinner />}><Account /></Suspense>;
}

function Account() {
  const { me, refresh } = useMe();
  const toast = useToast();
  const forced = useSearchParams().get('forced') === '1' || me.mustChangePassword;
  const sessions = useApi<{ sessions: Sess[] }>('/api/auth/sessions');
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function change(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (f.newPassword !== f.confirm) { setError(new Error('The new passwords do not match.')); return; }
    setBusy(true);
    try {
      await api('/api/auth/password', { body: { currentPassword: f.currentPassword, newPassword: f.newPassword } });
      toast.ok('Password changed. Other devices were signed out.'); setF({ currentPassword: '', newPassword: '', confirm: '' }); refresh(); await sessions.mutate();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    try { await api(`/api/auth/sessions/${id}`, { method: 'DELETE' }); await sessions.mutate(); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <>
      <PageHeader title="My account" description={`${me.name} · ${me.email} · ${me.role === 'ADMIN' ? 'Administrator' : 'Sales executive'}`} />
      {forced && <div className="mb-4"><Notice tone="amber" title="Password change required">Choose a new password before using the rest of the application.</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Change password">
          <form onSubmit={(e) => void change(e)} className="space-y-3 p-4">
            {!!error && <ErrorBox error={error} />}
            <Field label="Current password">{(i) => <Input id={i} type="password" autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />}</Field>
            <Field label="New password" hint="At least 12 characters with upper-case, lower-case and a number.">{(i) => <Input id={i} type="password" autoComplete="new-password" required minLength={12} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />}</Field>
            <Field label="Confirm new password">{(i) => <Input id={i} type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />}</Field>
            <Button type="submit" variant="primary" loading={busy}>Change password</Button>
          </form>
        </Card>
        <Card title="Active sessions">
          {!sessions.data ? <Spinner /> : (
            <ul className="divide-y divide-[rgb(var(--border))] text-sm">
              {sessions.data.sessions.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0"><p className="truncate">{s.userAgent ?? 'Unknown device'} {s.current && <Badge tone="green">This device</Badge>}</p><p className="muted text-xs">{s.ipAddress} · last used {fmtDate(s.lastUsedAt)}</p></div>
                  {!s.current && <Button size="sm" onClick={() => void revoke(s.id)}>Sign out</Button>}
                </li>))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
