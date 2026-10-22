'use client';
import { useState } from 'react';
import { Card, EmptyState, ErrorBox, Input, PageHeader, Pagination, Select, Spinner, Table, TBody, THead } from '@/components/ui';
import { qs, useApi } from '@/lib/client/fetcher';
import { fmtDate } from '@/lib/client/format';

type Log = { id: string; userEmail: string | null; action: string; entityType: string | null; entityId: string | null; metadata: Record<string, unknown>; ipAddress: string | null; createdAt: string };
const PAGE = 50;
const GROUPS = ['auth', 'user', 'customer', 'customers', 'campaign', 'agent', 'compliance', 'privacy', 'system', 'template', 'followup', 'appointment', 'integration', 'webhook'];

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const { data, error, mutate } = useApi<{ logs: Log[]; total: number }>(`/api/audit${qs({ page, pageSize: PAGE, action, entityType, from: from ? new Date(from).toISOString() : undefined })}`, { keepPreviousData: true });
  const reset = (fn: () => void) => { fn(); setPage(1); };
  return (
    <>
      <PageHeader title="Audit log" description="Who did what and when. Entries are append-only; sensitive values (passwords, tokens, full phone numbers) are never recorded." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select aria-label="Action group" className="w-48" value={action} onChange={(e) => reset(() => setAction(e.target.value))}><option value="">All actions</option>{GROUPS.map((g) => <option key={g} value={`${g}.`}>{g}.*</option>)}</Select>
        <Input aria-label="Entity type" className="w-44" placeholder="Entity type" value={entityType} onChange={(e) => reset(() => setEntityType(e.target.value))} />
        <Input aria-label="Since" type="date" className="w-44" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
      </div>
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : data.logs.length === 0 ? <Card><EmptyState title="No matching entries" /></Card> : (
        <>
          <Card className="overflow-hidden"><Table>
            <THead><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></THead>
            <TBody>{data.logs.map((l) => (
              <tr key={l.id}>
                <td className="muted whitespace-nowrap">{fmtDate(l.createdAt)}</td>
                <td className="text-xs">{l.userEmail ?? 'system'}<div className="muted">{l.ipAddress}</div></td>
                <td className="font-mono text-xs">{l.action}</td>
                <td className="text-xs">{l.entityType}<div className="muted break-all">{l.entityId}</div></td>
                <td className="max-w-xs break-words font-mono text-[11px] text-[rgb(var(--muted))]">{Object.keys(l.metadata).length ? JSON.stringify(l.metadata) : ''}</td>
              </tr>))}</TBody>
          </Table></Card>
          <Pagination page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
