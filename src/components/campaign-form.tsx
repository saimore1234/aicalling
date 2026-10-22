'use client';
import { useState } from 'react';
import { useToast } from '@/components/toast';
import { useStages } from '@/components/hooks';
import { Button, Checkbox, ErrorBox, Field, Input, Modal, Notice, Select } from '@/components/ui';
import { api, ApiClientError, useApi } from '@/lib/client/fetcher';
import { label, type Tone } from '@/lib/client/format';

export const STATUS_TONE: Record<string, Tone> = { DRAFT: 'neutral', RUNNING: 'green', PAUSED: 'amber', STOPPED: 'red', COMPLETED: 'blue' };

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']] as const;
type Window = { days: number[]; start: string; end: string };
export type CampaignFormData = {
  name: string; product: string | null; agentId: string; callWindows: Window[]; fallbackTimezone: string | null; maxAttempts: number; minIntervalMinutes: number; maxConcurrent: number; dailyLimit: number;
  retryOutcomes: string[]; isTest: boolean; testPhone: string | null; segmentFilter: { country?: string; stageId?: string; category?: string; leadSource?: string; product?: string };
};

export function CampaignForm({ existing, id, onClose, onSaved }: { existing?: CampaignFormData; id?: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const agents = useApi<{ agents: { id: string; name: string; active: boolean }[] }>('/api/agents');
  const stages = useStages();
  const [f, setF] = useState<CampaignFormData>(existing ?? {
    name: '', product: '', agentId: '', callWindows: [{ days: [1, 2, 3, 4, 5], start: '10:00', end: '18:00' }], fallbackTimezone: '', maxAttempts: 3, minIntervalMinutes: 240, maxConcurrent: 2, dailyLimit: 100,
    retryOutcomes: ['NO_ANSWER', 'BUSY'], isTest: false, testPhone: '', segmentFilter: {},
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof CampaignFormData>(k: K, v: CampaignFormData[K]) => setF((x) => ({ ...x, [k]: v }));
  const seg = (k: keyof CampaignFormData['segmentFilter'], v: string) => setF((x) => ({ ...x, segmentFilter: { ...x.segmentFilter, [k]: v || undefined } }));
  const fe = error instanceof ApiClientError ? error.fieldErrors : undefined;

  async function save() {
    setBusy(true); setError(null);
    try {
      const body = { ...f, product: f.product || null, fallbackTimezone: f.fallbackTimezone || null, testPhone: f.isTest ? f.testPhone || null : null };
      const res = id ? await api<{ leadsAdded: number }>(`/api/campaigns/${id}`, { method: 'PATCH', body }) : await api<{ leadsAdded: number }>('/api/campaigns', { body });
      toast.ok(`Campaign saved · ${res.leadsAdded} customer(s) queued`); onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  const setWin = (i: number, w: Window) => set('callWindows', f.callWindows.map((x, j) => (j === i ? w : x)));
  const toggleRetry = (o: string, on: boolean) => set('retryOutcomes', on ? [...new Set([...f.retryOutcomes, o])] : f.retryOutcomes.filter((x) => x !== o));

  return (
    <Modal wide open onClose={onClose} title={id ? 'Edit campaign' : 'New campaign'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save campaign</Button></>}>
      <div className="space-y-5">
        {!!error && <ErrorBox error={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Campaign name" error={fe?.name}>{(i) => <Input id={i} value={f.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <Field label="Product / offer">{(i) => <Input id={i} value={f.product ?? ''} onChange={(e) => set('product', e.target.value)} />}</Field>
          <Field label="AI agent" error={fe?.agentId}>{(i) => (
            <Select id={i} value={f.agentId} onChange={(e) => set('agentId', e.target.value)}>
              <option value="">Select an agent…</option>
              {agents.data?.agents.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>)}</Field>
          <Field label="Fallback timezone" hint="Used when a customer has no timezone. IANA name, e.g. Asia/Kolkata" error={fe?.fallbackTimezone}>{(i) => <Input id={i} value={f.fallbackTimezone ?? ''} onChange={(e) => set('fallbackTimezone', e.target.value)} placeholder="Asia/Kolkata" />}</Field>
        </div>

        <fieldset className="space-y-3 rounded-lg border border-[rgb(var(--border))] p-3">
          <legend className="px-1 text-sm font-semibold">Who to call</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Country (ISO)">{(i) => <Input id={i} maxLength={2} value={f.segmentFilter.country ?? ''} onChange={(e) => seg('country', e.target.value.toUpperCase())} placeholder="IN" />}</Field>
            <Field label="Pipeline stage">{(i) => <Select id={i} value={f.segmentFilter.stageId ?? ''} onChange={(e) => seg('stageId', e.target.value)}><option value="">Any</option>{stages.data?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
            <Field label="Category">{(i) => <Input id={i} value={f.segmentFilter.category ?? ''} onChange={(e) => seg('category', e.target.value)} />}</Field>
            <Field label="Lead source">{(i) => <Input id={i} value={f.segmentFilter.leadSource ?? ''} onChange={(e) => seg('leadSource', e.target.value)} />}</Field>
            <Field label="Product interest">{(i) => <Input id={i} value={f.segmentFilter.product ?? ''} onChange={(e) => seg('product', e.target.value)} />}</Field>
          </div>
          <p className="muted text-xs">Matching customers are queued now. Consent, do-not-call and calling hours are checked again for every call.</p>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-[rgb(var(--border))] p-3">
          <legend className="px-1 text-sm font-semibold">Calling windows (customer’s local time)</legend>
          {f.callWindows.map((w, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1">{DAYS.map(([d, n]) => (
                <button type="button" key={d} aria-pressed={w.days.includes(d)} onClick={() => setWin(i, { ...w, days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d].sort() })}
                  className={`rounded-md border px-2 py-1 text-xs ${w.days.includes(d) ? 'border-brand-600 bg-brand-600 text-white' : 'border-[rgb(var(--border))]'}`}>{n}</button>))}</div>
              <Input aria-label="From" type="time" className="w-28" value={w.start} onChange={(e) => setWin(i, { ...w, start: e.target.value })} />
              <span>to</span>
              <Input aria-label="Until" type="time" className="w-28" value={w.end} onChange={(e) => setWin(i, { ...w, end: e.target.value })} />
              {f.callWindows.length > 1 && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => set('callWindows', f.callWindows.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          ))}
          <Button size="sm" onClick={() => set('callWindows', [...f.callWindows, { days: [6], start: '10:00', end: '14:00' }])}>Add window</Button>
          <p className="muted text-xs">The stricter of this window and the country’s legal calling hours always applies.</p>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-[rgb(var(--border))] p-3">
          <legend className="px-1 text-sm font-semibold">Pacing and retries</legend>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Max concurrent calls" error={fe?.maxConcurrent}>{(i) => <Input id={i} type="number" min={1} max={50} value={f.maxConcurrent} onChange={(e) => set('maxConcurrent', Number(e.target.value))} />}</Field>
            <Field label="Daily limit" error={fe?.dailyLimit}>{(i) => <Input id={i} type="number" min={1} value={f.dailyLimit} onChange={(e) => set('dailyLimit', Number(e.target.value))} />}</Field>
            <Field label="Max attempts" error={fe?.maxAttempts}>{(i) => <Input id={i} type="number" min={1} max={10} value={f.maxAttempts} onChange={(e) => set('maxAttempts', Number(e.target.value))} />}</Field>
            <Field label="Retry gap (min)" error={fe?.minIntervalMinutes}>{(i) => <Input id={i} type="number" min={15} value={f.minIntervalMinutes} onChange={(e) => set('minIntervalMinutes', Number(e.target.value))} />}</Field>
          </div>
          <div className="flex flex-wrap gap-4">{['NO_ANSWER', 'BUSY', 'FAILED'].map((o) => <Checkbox key={o} label={`Retry on ${label(o).toLowerCase()}`} checked={f.retryOutcomes.includes(o)} onChange={(e) => toggleRetry(o, e.target.checked)} />)}</div>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-[rgb(var(--border))] p-3">
          <legend className="px-1 text-sm font-semibold">Test campaign</legend>
          <Checkbox label="Test mode: dial only my own number" checked={f.isTest} onChange={(e) => set('isTest', e.target.checked)} />
          {f.isTest && <Field label="Test phone (E.164)" error={fe?.testPhone}>{(i) => <Input id={i} value={f.testPhone ?? ''} onChange={(e) => set('testPhone', e.target.value)} placeholder="+919800000000" />}</Field>}
        </fieldset>
        <Notice tone="blue">Creating a campaign never places calls. Its mode (demo or live) is fixed at creation from the current system mode.</Notice>
      </div>
    </Modal>
  );
}
