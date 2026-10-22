'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge, Card, DemoBadge, ErrorBox, Notice, PageHeader, Spinner, Stat } from '@/components/ui';
import { useApi } from '@/lib/client/fetcher';
import { fmtDate, fmtDuration, label, OUTCOME_LABEL, OUTCOME_TONE } from '@/lib/client/format';

type Seg = { role: string; text: string; at?: string; ts?: string };
type Detail = {
  call: { id: string; status: string; outcome: string | null; summary: string | null; durationSeconds: number | null; createdAt: string; answeredAt: string | null; endedAt: string | null; attemptNumber: number; isDemo: boolean; isTest: boolean; errorCode: string | null; errorMessage: string | null; campaignName: string | null; agentName: string | null; toNumber: string; costAmount: string | null; costCurrency: string | null; analysisStatus?: string | null };
  customer: { id: string; name: string; company: string | null };
  transcript: { segments: Seg[]; fullText: string } | null;
  events: { id: string; type: string; status: string | null; occurredAt: string; payload: Record<string, unknown> }[];
  qualification: { outcome: string; score: number; reason: string; evidence: string[]; interestLevel: string | null; nextStep: string | null; callbackAt: string | null; meetingPreference: string | null; source: string; aiModel: string | null } | null;
  followUps: { id: string; type: string; status: string; title: string | null; scheduledFor: string; lastError: string | null }[];
  messages: { id: string; channel: string; status: string; subject: string | null; isDemo: boolean; createdAt: string; errorMessage: string | null }[];
};

export default function CallDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate } = useApi<Detail>(`/api/calls/${id}`, { refreshInterval: (d) => (d && ['QUEUED', 'INITIATED', 'RINGING', 'IN_PROGRESS'].includes(d.call.status) ? 4000 : 0) });
  if (error) return <ErrorBox error={error} onRetry={() => void mutate()} />;
  if (!data) return <Spinner />;
  const { call: c, customer, transcript, events, qualification: q, followUps, messages } = data;
  return (
    <>
      <PageHeader title={`Call with ${customer.name}`}
        description={<span className="flex flex-wrap items-center gap-2"><Link className="text-brand-700 hover:underline dark:text-brand-300" href={`/customers/${customer.id}`}>View customer</Link>{c.campaignName && <span>· {c.campaignName}</span>}{c.agentName && <span>· agent {c.agentName}</span>}{c.isDemo && <DemoBadge />}{c.isTest && <Badge tone="purple">Test</Badge>}</span>} />
      {c.isDemo && <Notice tone="amber" title="Simulated call">This call was produced by DEMO mode. No real phone call was made and the transcript is scripted.</Notice>}
      <div className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Status" value={label(c.status)} />
        <Stat label="Outcome" value={c.outcome ? (OUTCOME_LABEL[c.outcome] ?? label(c.outcome)) : 'Pending'} />
        <Stat label="Duration" value={fmtDuration(c.durationSeconds)} hint={`attempt #${c.attemptNumber}`} />
        <Stat label="Lead score" value={q ? q.score : '—'} hint={q ? `${q.source === 'HUMAN' ? 'set by a person' : 'AI assessed'}` : 'not analysed yet'} />
      </div>
      {(c.errorCode || c.errorMessage) && <div className="mb-4"><Notice tone="red" title="Call problem">{c.errorCode} {c.errorMessage}</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Transcript">
            {!transcript || transcript.segments.length === 0 ? <p className="muted p-4 text-sm">No transcript was captured for this call.</p> : (
              <ol className="space-y-2 p-4">
                {transcript.segments.map((s, i) => (
                  <li key={i} className={`flex ${s.role === 'assistant' || s.role === 'agent' ? '' : 'justify-end'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${s.role === 'assistant' || s.role === 'agent' ? 'bg-[rgb(var(--surface-2))]' : 'bg-brand-600 text-white'}`}>
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">{s.role === 'assistant' || s.role === 'agent' ? 'AI agent' : 'Customer'}</p>
                      {s.text}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card title="Timeline">
            <ul className="divide-y divide-[rgb(var(--border))] text-sm">
              {events.length === 0 && <li className="muted p-4">No events recorded.</li>}
              {events.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-2"><span><span className="font-medium">{label(e.type)}</span>{e.status && <span className="muted"> · {label(e.status)}</span>}</span><span className="muted whitespace-nowrap text-xs">{fmtDate(e.occurredAt)}</span></li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="AI assessment">
            {!q ? <p className="muted p-4 text-sm">{c.status === 'COMPLETED' ? 'Analysis is pending or could not be completed. A follow-up task asks a person to review the call.' : 'Available once the call has finished.'}</p> : (
              <div className="space-y-3 p-4 text-sm">
                <Badge tone={OUTCOME_TONE[q.outcome] ?? 'neutral'}>{OUTCOME_LABEL[q.outcome] ?? label(q.outcome)}</Badge>
                <p>{q.reason}</p>
                {q.evidence.length > 0 && <div><p className="muted text-xs font-medium uppercase">Evidence from the call</p><ul className="mt-1 list-disc space-y-1 pl-5">{q.evidence.map((e, i) => <li key={i} className="italic">“{e}”</li>)}</ul></div>}
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <dt className="muted">Interest</dt><dd>{label(q.interestLevel)}</dd>
                  <dt className="muted">Next step</dt><dd>{q.nextStep ?? '—'}</dd>
                  <dt className="muted">Callback</dt><dd>{fmtDate(q.callbackAt)}</dd>
                  <dt className="muted">Meeting</dt><dd>{q.meetingPreference ?? '—'}</dd>
                  <dt className="muted">Model</dt><dd>{q.aiModel ?? '—'}</dd>
                </dl>
              </div>
            )}
          </Card>
          {c.summary && <Card title="Summary"><p className="p-4 text-sm">{c.summary}</p></Card>}
          <Card title="Follow-ups">
            <ul className="divide-y divide-[rgb(var(--border))] text-sm">
              {followUps.length === 0 && <li className="muted p-4">None created.</li>}
              {followUps.map((f) => <li key={f.id} className="px-4 py-2"><div className="flex justify-between gap-2"><span>{f.title ?? label(f.type)}</span><Badge tone={f.status === 'DONE' || f.status === 'SENT' ? 'green' : f.status === 'FAILED' ? 'red' : 'neutral'}>{label(f.status)}</Badge></div><p className="muted text-xs">{label(f.type)} · {fmtDate(f.scheduledFor)}</p>{f.lastError && <p className="text-xs text-red-600">{f.lastError}</p>}</li>)}
            </ul>
          </Card>
          {messages.length > 0 && (
            <Card title="Messages sent">
              <ul className="divide-y divide-[rgb(var(--border))] text-sm">{messages.map((m) => <li key={m.id} className="flex justify-between px-4 py-2"><span>{label(m.channel)} {m.isDemo && <DemoBadge />}</span><Badge tone={m.status === 'FAILED' ? 'red' : 'neutral'}>{label(m.status)}</Badge></li>)}</ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
