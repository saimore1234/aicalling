'use client';
import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useMe } from '@/components/AppShell';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ConfirmDialog, ErrorBox, Notice, PageHeader, Spinner } from '@/components/ui';
import { api, useApi } from '@/lib/client/fetcher';
import { fmtDate } from '@/lib/client/format';

type Integration = { key: string; label: string; configured: boolean; missing: string[]; env: Record<string, boolean | string>; webhooks: string[]; lastCheck?: { ok: boolean; at: string; error?: string } | null };
type Settings = { mode: 'demo' | 'live'; liveEnabledAt?: string; liveEnabledBy?: string };

export default function IntegrationsPage() {
  const toast = useToast();
  const { refresh } = useMe();
  const list = useApi<{ integrations: Integration[] } | Integration[]>('/api/integrations');
  const settings = useApi<{ settings: Settings }>('/api/system/settings');
  const [checking, setChecking] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const [liveDialog, setLiveDialog] = useState(false);
  const [busy, setBusy] = useState(false);

  const items: Integration[] | undefined = Array.isArray(list.data) ? list.data : list.data?.integrations;
  const mode = settings.data?.settings.mode;

  async function check(key: string) {
    setChecking(key);
    try { const r = await api<{ ok: boolean; error?: string }>('/api/integrations/check', { body: { key } }); setResults((x) => ({ ...x, [key]: r })); }
    catch (e) { toast.error((e as Error).message); } finally { setChecking(null); }
  }
  async function setMode(next: 'demo' | 'live') {
    setBusy(true);
    try { await api('/api/system/settings', { method: 'PATCH', body: next === 'live' ? { mode: 'live', confirm: 'ENABLE LIVE MODE' } : { mode: 'demo' } }); toast.ok(`Switched to ${next.toUpperCase()} mode`); await settings.mutate(); refresh(); setLiveDialog(false); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Integrations" description="Credentials are read from server environment variables and are never shown here. This page shows which are present, the webhook URLs to register, and lets you test connectivity without placing calls or sending messages." />
      <Card title="Operating mode" className="mb-6">
        <div className="space-y-3 p-4 text-sm">
          {!settings.data ? <Spinner /> : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={mode === 'live' ? 'red' : 'amber'}>{mode === 'live' ? 'LIVE — real calls and messages' : 'DEMO — simulated only'}</Badge>
                {mode === 'live' && settings.data.settings.liveEnabledAt && <span className="muted text-xs">enabled {fmtDate(settings.data.settings.liveEnabledAt)} by {settings.data.settings.liveEnabledBy}</span>}
                {mode === 'demo' ? <Button variant="danger" onClick={() => setLiveDialog(true)}>Switch to live mode…</Button> : <Button onClick={() => void setMode('demo')} loading={busy}>Switch back to demo mode</Button>}
              </div>
              <p className="muted">In DEMO mode every call, message and transcript is simulated and clearly labelled DEMO; nothing reaches a real person. The system never silently falls back from live to demo — if a provider is missing in live mode, the action fails with an explanation.</p>
            </>
          )}
        </div>
      </Card>

      {list.error ? <ErrorBox error={list.error} onRetry={() => void list.mutate()} /> : !items ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((i) => {
            const r = results[i.key];
            return (
              <Card key={i.key} title={i.label} actions={<Badge tone={i.configured ? 'green' : 'amber'}>{i.configured ? 'Configured' : 'Not configured'}</Badge>}>
                <div className="space-y-3 p-4 text-sm">
                  <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {Object.entries(i.env).map(([k, v]) => (
                      <li key={k} className="flex items-center gap-1.5 font-mono text-xs">
                        {typeof v === 'boolean' ? (v ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-label="set" /> : <XCircle className="h-3.5 w-3.5 text-red-500" aria-label="missing" />) : <span className="muted">=</span>}
                        {k}{typeof v === 'string' && <span className="muted"> {v}</span>}
                      </li>))}
                  </ul>
                  {i.missing.length > 0 && <p className="text-amber-700 dark:text-amber-400">Missing: {i.missing.join(', ')}</p>}
                  {i.webhooks.length > 0 && (
                    <div><p className="muted text-xs font-medium uppercase">Webhook URLs</p><ul className="mt-1 space-y-1">{i.webhooks.map((w) => <li key={w} className="break-all font-mono text-xs">{w}</li>)}</ul></div>
                  )}
                  <div className="flex items-center gap-3">
                    <Button size="sm" loading={checking === i.key} onClick={() => void check(i.key)}>Test connection</Button>
                    {r && <span className={r.ok ? 'text-emerald-600' : 'text-red-600'}>{r.ok ? 'Connection OK' : r.error}</span>}
                  </div>
                </div>
              </Card>);
          })}
        </div>
      )}

      <ConfirmDialog open={liveDialog} onClose={() => setLiveDialog(false)} danger requireText="ENABLE LIVE MODE" confirmLabel="Enable live mode" loading={busy} title="Switch to live mode" onConfirm={() => void setMode('live')}>
        <Notice tone="red">Live mode lets campaigns place real phone calls and send real SMS, email and WhatsApp messages. Confirm that your providers are configured, your compliance policies are reviewed, and your legal basis for contacting customers is documented. Demo campaigns stop dialling; create a new live campaign afterwards.</Notice>
      </ConfirmDialog>
    </>
  );
}
