'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '@/components/AppShell';
import { useUsers } from '@/components/hooks';
import { useToast } from '@/components/toast';
import { Badge, DemoBadge, ErrorBox, Input, PageHeader, Select, Spinner } from '@/components/ui';
import { api, qs, useApi } from '@/lib/client/fetcher';
import { OUTCOME_LABEL, OUTCOME_TONE } from '@/lib/client/format';

type Card = { id: string; name: string; company: string | null; leadScore: number | null; lastOutcome: string | null; productInterest: string | null; ownerName: string | null; isDemo: boolean; doNotCall: boolean };
type Col = { stage: { id: string; name: string; isWon: boolean; isLost: boolean }; total: number; cards: Card[] };

export default function PipelinePage() {
  const { isAdmin } = useMe();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const users = useUsers().data?.users ?? [];
  const { data, error, mutate } = useApi<{ columns: Col[] }>(`/api/pipeline${qs({ q, ownerId })}`);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  async function move(cardId: string, toStageId: string) {
    if (!data) return;
    const prev = data;
    const card = data.columns.flatMap((c) => c.cards).find((c) => c.id === cardId);
    if (!card) return;
    const fromCol = data.columns.find((c) => c.cards.some((x) => x.id === cardId));
    if (fromCol?.stage.id === toStageId) return;
    // Optimistic update, rolled back if the server refuses.
    void mutate({ columns: data.columns.map((c) => c.stage.id === toStageId ? { ...c, total: c.total + 1, cards: [card, ...c.cards] } : c.cards.some((x) => x.id === cardId) ? { ...c, total: c.total - 1, cards: c.cards.filter((x) => x.id !== cardId) } : c) }, false);
    try { await api(`/api/customers/${cardId}/stage`, { method: 'PATCH', body: { stageId: toStageId } }); void mutate(); }
    catch (e) { toast.error((e as Error).message); void mutate(prev, false); }
  }

  return (
    <>
      <PageHeader title="Lead pipeline" description="Drag a card to another column, or use the stage menu on the card. Stages also move automatically after AI-analysed calls." />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input aria-label="Search" placeholder="Search customers" className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} />
        {isAdmin && <Select aria-label="Owner" className="max-w-[12rem]" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">All owners</option><option value="none">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
      </div>
      {error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : !data ? <Spinner /> : (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 lg:mx-0 lg:px-0">
          {data.columns.map((col) => (
            <section key={col.stage.id} aria-label={col.stage.name}
              onDragOver={(e) => { e.preventDefault(); setOver(col.stage.id); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain') || dragging; if (id) void move(id, col.stage.id); setDragging(null); }}
              className={`flex w-72 shrink-0 flex-col rounded-xl border bg-[rgb(var(--surface-2))] ${over === col.stage.id ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-[rgb(var(--border))]'}`}>
              <header className="flex items-center justify-between px-3 py-2.5">
                <h2 className="text-sm font-semibold">{col.stage.name}</h2>
                <Badge tone={col.stage.isWon ? 'green' : col.stage.isLost ? 'red' : 'neutral'}>{col.total}</Badge>
              </header>
              <ul className="flex-1 space-y-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: '70vh' }}>
                {col.cards.map((c) => (
                  <li key={c.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); setDragging(c.id); }} onDragEnd={() => setDragging(null)}
                    className={`card cursor-grab p-3 text-sm active:cursor-grabbing ${dragging === c.id ? 'opacity-50' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                      {c.leadScore !== null && <span className="rounded bg-brand-100 px-1.5 text-xs font-semibold tabular-nums text-brand-800" title="Lead score">{c.leadScore}</span>}
                    </div>
                    {c.company && <p className="muted text-xs">{c.company}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {c.lastOutcome && <Badge tone={OUTCOME_TONE[c.lastOutcome] ?? 'neutral'}>{OUTCOME_LABEL[c.lastOutcome]}</Badge>}
                      {c.doNotCall && <Badge tone="red">DNC</Badge>}{c.isDemo && <DemoBadge />}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="muted truncate text-xs">{c.ownerName ?? 'Unassigned'}</span>
                      <select aria-label={`Move ${c.name} to stage`} className="max-w-[7rem] rounded border border-[rgb(var(--border))] bg-transparent px-1 py-0.5 text-xs" value={col.stage.id} onChange={(e) => void move(c.id, e.target.value)}>
                        {data.columns.map((o) => <option key={o.stage.id} value={o.stage.id}>{o.stage.name}</option>)}
                      </select>
                    </div>
                  </li>
                ))}
                {col.cards.length === 0 && <li className="muted px-2 py-6 text-center text-xs">Drop a card here</li>}
                {col.total > col.cards.length && <li className="muted px-2 pb-2 text-center text-xs">+{col.total - col.cards.length} more — use Customers to see all</li>}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
