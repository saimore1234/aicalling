'use client';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info } from 'lucide-react';
import { useMe } from '@/components/AppShell';
import { Card, DemoBadge, EmptyState, ErrorBox, PageHeader, Select, Spinner, Stat, Notice } from '@/components/ui';
import { qs, useApi } from '@/lib/client/fetcher';
import { fmtDuration, fmtNum, fmtPct, OUTCOME_LABEL } from '@/lib/client/format';

type Dash = {
  mode: 'demo' | 'live';
  filters: { from: string; to: string; demo: string };
  includesDemoData: boolean;
  totals: Record<string, number | null>;
  cost: { currency: string; total: number }[];
  outcomes: { outcome: string; n: number }[];
  daily: { day: string; placed: number; connected: number; interested: number }[];
  pipeline: { key: string; name: string; n: number }[];
  definitions: Record<string, string>;
};
const RANGES = [{ v: '7', l: 'Last 7 days' }, { v: '30', l: 'Last 30 days' }, { v: '90', l: 'Last 90 days' }];
const C = { placed: '#94a3b8', connected: '#3a63f5', interested: '#059669' };

export default function DashboardPage() {
  const { mode, isAdmin } = useMe();
  const [range, setRange] = useState('30');
  const [scope, setScope] = useState<'auto' | 'true' | 'false' | 'all'>('auto');
  const from = new Date(Date.now() - Number(range) * 86_400_000).toISOString();
  const { data, error, isLoading, mutate } = useApi<Dash>(`/api/dashboard${qs({ from, demo: scope === 'auto' ? undefined : scope })}`, { refreshInterval: 30_000 });

  const t = data?.totals;
  const def = (k: string) => data?.definitions[k];
  return (
    <>
      <PageHeader title="Dashboard" description="Every figure below is calculated from the database for the selected period. Hover the info icon for the exact definition."
        actions={<>
          <Select aria-label="Period" value={range} onChange={(e) => setRange(e.target.value)} className="w-40">{RANGES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</Select>
          <Select aria-label="Data scope" value={scope} onChange={(e) => setScope(e.target.value as never)} className="w-48">
            <option value="auto">{mode === 'demo' ? 'Demo data (current mode)' : 'Live data (current mode)'}</option>
            <option value="true">Demo data only</option><option value="false">Live data only</option><option value="all">Demo + live</option>
          </Select>
        </>} />
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : isLoading || !data || !t ? <Spinner /> : (
        <div className="space-y-6">
          {data.filters.demo !== 'false' && data.includesDemoData && (
            <Notice tone="amber" title="Includes simulated data">Figures include <strong>DEMO</strong> calls and messages. They illustrate the workflow and do not represent real customers.</Notice>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            <Stat label="Customers" value={fmtNum(t.customers)} hint="Active, non-archived records" />
            <Stat label="Calls placed" value={fmtNum(t.callsPlaced)} hint={<Def text={def('callsPlaced')} />} />
            <Stat label="Connected" value={fmtNum(t.callsConnected)} hint={<><span>{fmtPct(t.connectRate)} connect rate</span> <Def text={def('callsConnected')} /></>} />
            <Stat label="Avg. call length" value={fmtDuration(t.avgDurationSeconds)} hint={<Def text={def('avgDurationSeconds')} />} />
            <Stat label="Interested" value={fmtNum(t.interested)} tone="good" hint={<><span>{fmtPct(t.conversionRate)} of connected</span> <Def text={def('interested')} /></>} />
            <Stat label="Qualified" value={fmtNum(t.qualified)} tone="good" hint={<Def text={def('qualified')} />} />
            <Stat label="Meetings requested" value={fmtNum(t.meetingsRequested)} hint={<Def text={def('meetingsRequested')} />} />
            <Stat label="Opt-outs" value={fmtNum(t.optOuts)} hint={<Def text={def('optOuts')} />} />
            <Stat label="Failed calls" value={fmtNum(t.failedCalls)} tone={t.failedCalls ? 'bad' : 'default'} hint={<Def text={def('failedCalls')} />} />
            <Stat label="Messages sent" value={fmtNum(t.messagesSent)} hint={<Def text={def('messagesSent')} />} />
            <Stat label="Messages delivered" value={fmtNum(t.messagesDelivered)} hint={<Def text={def('messagesDelivered')} />} />
            <Stat label="Failed / blocked messages" value={fmtNum(t.messagesFailedOrBlocked)} tone={t.messagesFailedOrBlocked ? 'bad' : 'default'} hint={<Def text={def('messagesFailedOrBlocked')} />} />
          </div>
          {isAdmin && data.cost.length > 0 && (
            <Card title="Provider call cost"><div className="flex flex-wrap gap-6">{data.cost.map((c) => <div key={c.currency}><p className="text-2xl font-semibold tabular-nums">{c.total.toFixed(2)} <span className="muted text-sm">{c.currency}</span></p></div>)}</div><p className="muted mt-2 text-xs">{def('cost')}</p></Card>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Calls per day">
              {data.daily.length === 0 ? <EmptyState title="No calls in this period" /> : (
                <div className="h-64" role="img" aria-label="Line chart of calls placed, connected and interested per day">
                  <ResponsiveContainer><LineChart data={data.daily}><CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Legend />
                    <Line type="monotone" dataKey="placed" name="Placed" stroke={C.placed} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="connected" name="Connected" stroke={C.connected} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="interested" name="Interested" stroke={C.interested} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
                </div>)}
            </Card>
            <Card title="Outcomes">
              {data.outcomes.length === 0 ? <EmptyState title="No outcomes yet" /> : (
                <div className="h-64" role="img" aria-label="Bar chart of call outcomes">
                  <ResponsiveContainer><BarChart data={data.outcomes.map((o) => ({ name: OUTCOME_LABEL[o.outcome] ?? o.outcome, n: o.n }))} layout="vertical" margin={{ left: 30 }}><CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="n" name="Calls" fill={C.connected} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer>
                </div>)}
            </Card>
          </div>
          <Card title="Pipeline">
            <div className="h-56" role="img" aria-label="Bar chart of customers per pipeline stage">
              <ResponsiveContainer><BarChart data={data.pipeline}><CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="n" name="Customers" fill={C.connected} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
            </div>
          </Card>
          <p className="muted flex items-center gap-1.5 text-xs">Data scope: {data.filters.demo === 'true' ? <DemoBadge /> : data.filters.demo === 'false' ? 'live records' : 'demo and live records'} · {new Date(data.filters.from).toLocaleDateString()} – {new Date(data.filters.to).toLocaleDateString()}</p>
        </div>
      )}
    </>
  );
}
function Def({ text }: { text?: string }) {
  if (!text) return null;
  return <span title={text} className="inline-flex align-middle" tabIndex={0} aria-label={text}><Info className="h-3.5 w-3.5 cursor-help opacity-60" /></span>;
}
