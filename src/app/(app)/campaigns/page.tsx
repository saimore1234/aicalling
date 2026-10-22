'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { CampaignForm, STATUS_TONE } from '@/components/campaign-form';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, PageHeader, Spinner, Table, TBody, THead } from '@/components/ui';
import { useApi } from '@/lib/client/fetcher';
import { fmtDate, label } from '@/lib/client/format';

type CampaignListItem = {
  id: string; name: string; status: string; product: string | null; isDemo: boolean; isTest: boolean; agentName: string | null; leadCount: number; doneCount: number; createdAt: string;
};

export default function CampaignsPage() {
  const { data, error, mutate } = useApi<{ campaigns: CampaignListItem[] }>('/api/campaigns');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Campaigns" description="A campaign queues customers for an AI agent to call. Nothing is dialled until an administrator explicitly starts it."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New campaign</Button>} />
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : data.campaigns.length === 0 ? (
        <Card><EmptyState title="No campaigns yet" action={<Button variant="primary" onClick={() => setCreating(true)}>Create a campaign</Button>}>Create an AI agent first, then build a campaign around a customer segment.</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead><th>Name</th><th>Status</th><th>Agent</th><th className="text-right">Progress</th><th>Created</th></THead>
            <TBody>
              {data.campaigns.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/campaigns/${c.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{c.name}</Link>{' '}{c.isDemo && <DemoBadge />}{c.isTest && <Badge tone="purple">Test</Badge>}</td>
                  <td><Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{label(c.status)}</Badge></td>
                  <td>{c.agentName ?? '—'}</td>
                  <td className="text-right tabular-nums">{c.doneCount} / {c.leadCount}</td>
                  <td className="muted">{fmtDate(c.createdAt, { time: false })}</td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {creating && <CampaignForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void mutate(); }} />}
    </>
  );
}

