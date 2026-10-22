'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApi, qs } from '@/lib/client/fetcher';
import { Badge, Card, DemoBadge, EmptyState, ErrorBox, Input, PageHeader, Pagination, Select, Spinner, Table, TBody, THead } from '@/components/ui';
import { fmtDate, fmtDuration, label, OUTCOME_LABEL, OUTCOME_TONE } from '@/lib/client/format';

type Row = {
  id: string; status: string; outcome: string | null; createdAt: string; durationSeconds: number | null; attempt: number; isDemo: boolean; isTest: boolean; summary: string | null; toNumber: string;
  customerId: string; customerName: string; company: string | null; campaignName: string | null; agentName: string | null;
};
const PAGE = 25;

export default function CallsPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [outcome, setOutcome] = useState('');
  const [demo, setDemo] = useState('');
  const { data, error, mutate } = useApi<{ calls: Row[]; total: number }>(`/api/calls${qs({ page, pageSize: PAGE, q, status, outcome, demo })}`, { keepPreviousData: true });
  const reset = (fn: () => void) => { fn(); setPage(1); };
  return (
    <>
      <PageHeader title="Call history" description="Every call attempt with its status, AI-assessed outcome, and transcript." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Search" className="max-w-xs" placeholder="Search customer, company or number" value={q} onChange={(e) => reset(() => setQ(e.target.value))} />
        <Select aria-label="Status" className="w-40" value={status} onChange={(e) => reset(() => setStatus(e.target.value))}>
          <option value="">Any status</option>{['QUEUED', 'INITIATED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <Select aria-label="Outcome" className="w-48" value={outcome} onChange={(e) => reset(() => setOutcome(e.target.value))}>
          <option value="">Any outcome</option>{Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Data type" className="w-36" value={demo} onChange={(e) => reset(() => setDemo(e.target.value))}>
          <option value="">Demo + live</option><option value="false">Live only</option><option value="true">Demo only</option>
        </Select>
      </div>
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : data.calls.length === 0 ? (
        <Card><EmptyState title="No calls match">Calls appear here once a campaign has dialled.</EmptyState></Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <THead><th>When</th><th>Customer</th><th>Campaign</th><th>Status</th><th>Outcome</th><th>Duration</th></THead>
              <TBody>
                {data.calls.map((c) => (
                  <tr key={c.id}>
                    <td className="muted whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                    <td><Link href={`/calls/${c.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{c.customerName}</Link>{' '}{c.isDemo && <DemoBadge />}{c.isTest && <Badge tone="purple">Test</Badge>}
                      <div className="muted text-xs">{c.company ?? ''} {c.toNumber}</div></td>
                    <td>{c.campaignName ?? '—'}<div className="muted text-xs">attempt #{c.attempt}</div></td>
                    <td>{label(c.status)}</td>
                    <td>{c.outcome ? <Badge tone={OUTCOME_TONE[c.outcome] ?? 'neutral'}>{OUTCOME_LABEL[c.outcome] ?? label(c.outcome)}</Badge> : '—'}</td>
                    <td>{fmtDuration(c.durationSeconds)}</td>
                  </tr>
                ))}
              </TBody>
            </Table>
          </Card>
          <Pagination page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
