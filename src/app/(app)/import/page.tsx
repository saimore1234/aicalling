'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Notice, PageHeader, Select, Spinner, Stat, Table, TBody, THead } from '@/components/ui';
import { api, useApi } from '@/lib/client/fetcher';
import { fmtDate, label } from '@/lib/client/format';
import { TARGET_FIELDS } from '@/server/imports/fields';

type Imp = {
  id: string; fileName: string; status: string; headers: string[]; sampleRows: Record<string, string>[]; mapping: Record<string, string>;
  options: { defaultCountry?: string; consentChannels?: string[]; defaultConsentSource?: string };
  totalRows: number; validRows: number; invalidRows: number; duplicateRows: number; importedRows: number; preview: Record<string, unknown>[]; error: string | null;
};
type Detail = { import: Imp; errorCount: number; errorSample: { id: string; rowNumber: number; kind: string; errors: string[]; rawData: Record<string, string> }[] };
const STEPS = ['Upload', 'Map columns', 'Review', 'Done'];

export default function ImportPage() {
  const toast = useToast();
  const [imp, setImp] = useState<Imp | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [opts, setOpts] = useState({ defaultCountry: '', consentChannels: ['VOICE'] as string[], defaultConsentSource: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [polling, setPolling] = useState(false);
  const [editing, setEditing] = useState(false);
  const detail = useApi<Detail>(imp ? `/api/imports/${imp.id}` : null, { refreshInterval: polling ? 1500 : 0 });
  const live = detail.data?.import ?? imp;

  const status = live?.status;
  useEffect(() => { setPolling(status === 'VALIDATING' || status === 'IMPORTING'); }, [status]);

  const step = !live ? 0 : editing && status === 'PREVIEW' ? 1 : status === 'UPLOADED' || status === 'FAILED' || status === 'VALIDATING' ? 1 : status === 'PREVIEW' || status === 'IMPORTING' ? 2 : 3;

  async function upload(file: File) {
    setBusy(true); setError(null);
    try {
      const fd = new FormData(); fd.set('file', file);
      const r = await api<{ import: Imp }>('/api/imports', { form: fd });
      setImp(r.import); setMapping(r.import.mapping);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function validate() {
    if (!live) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/imports/${live.id}/validate`, { body: { mapping, options: { defaultCountry: opts.defaultCountry || undefined, consentChannels: opts.consentChannels, defaultConsentSource: opts.defaultConsentSource || undefined } } });
      setEditing(false); setPolling(true); void detail.mutate();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function commit() {
    if (!live) return;
    setBusy(true); setError(null);
    try { await api(`/api/imports/${live.id}/commit`, { body: {} }); setPolling(true); void detail.mutate(); toast.ok('Import started'); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  const reset = useCallback(() => { setImp(null); setEditing(false); setError(null); setMapping({}); if (fileRef.current) fileRef.current.value = ''; }, []);

  return (
    <>
      <PageHeader title="Import customers" description="Upload a CSV or Excel file, map its columns, review problems, then import. Nothing is written to your customer list until you confirm."
        actions={<><a href="/templates/customers-sample.csv" download><Button><Download className="h-4 w-4" />Sample CSV</Button></a><a href="/templates/customers-template.xlsx" download><Button><FileSpreadsheet className="h-4 w-4" />Excel template</Button></a></>} />
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Progress">
        {STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={`rounded-full px-3 py-1 text-xs font-medium ${i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-emerald-100 text-emerald-800' : 'bg-[rgb(var(--surface-2))] muted'}`}>{i + 1}. {s}</li>)}
      </ol>
      {!!error && <div className="mb-4"><ErrorBox error={error} /></div>}

      {step === 0 && (
        <Card>
          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-[rgb(var(--border))] p-10 text-center hover:border-brand-400">
            <Upload className="h-8 w-8 text-brand-600" />
            <span className="font-medium">{busy ? 'Uploading…' : 'Choose a .csv or .xlsx file'}</span>
            <span className="muted text-xs">Up to 20 MB. Required column: name, plus a phone or an email.</span>
            <input ref={fileRef} type="file" accept=".csv,.xlsx" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </label>
          <ImportHistory />
        </Card>
      )}

      {step === 1 && live && (
        <div className="space-y-4">
          {live.status === 'FAILED' && live.error && <ErrorBox error={new Error(live.error)} />}
          {live.status === 'VALIDATING' ? <Card><Spinner label={`Checking ${live.fileName}…`} /></Card> : (
            <>
              <Card title={`Map columns — ${live.fileName}`}>
                <Table>
                  <THead><th className="th">Column in your file</th><th className="th">Example</th><th className="th">Maps to</th></THead>
                  <TBody>
                    {live.headers.map((h) => (
                      <tr key={h}>
                        <td className="td font-medium">{h}</td>
                        <td className="td muted max-w-[14rem] truncate text-xs">{live.sampleRows.map((r) => r[h]).filter(Boolean).slice(0, 2).join(' · ') || '—'}</td>
                        <td className="td"><Select aria-label={`Map ${h}`} value={mapping[h] ?? ''} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                          <option value="">Ignore this column</option>
                          {TARGET_FIELDS.map((t) => <option key={t.key} value={t.key}>{t.label}{'required' in t && t.required ? ' *' : ''}</option>)}
                          <option value={`custom:${h}`}>Keep as custom field “{h}”</option>
                        </Select></td>
                      </tr>
                    ))}
                  </TBody>
                </Table>
              </Card>
              <Card title="Options">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Default country" hint="Used to interpret phone numbers that lack a +country code, e.g. IN">{(i) => <Input id={i} maxLength={2} value={opts.defaultCountry} onChange={(e) => setOpts({ ...opts, defaultCountry: e.target.value.toUpperCase() })} />}</Field>
                  <Field label="Default consent source" hint="Only used for rows that explicitly say consent was granted but give no source.">{(i) => <Input id={i} value={opts.defaultConsentSource} onChange={(e) => setOpts({ ...opts, defaultConsentSource: e.target.value })} />}</Field>
                </div>
                <fieldset className="mt-4"><legend className="mb-1 text-sm font-medium">Channels a “consent” column applies to</legend>
                  <div className="flex flex-wrap gap-4">{['VOICE', 'SMS', 'EMAIL', 'WHATSAPP'].map((c) => <Checkbox key={c} label={label(c)} checked={opts.consentChannels.includes(c)} onChange={(e) => setOpts({ ...opts, consentChannels: e.target.checked ? [...opts.consentChannels, c] : opts.consentChannels.filter((x) => x !== c) })} />)}</div></fieldset>
                <div className="mt-4"><Notice tone="blue">Importing a number never grants permission to call it. Consent is only recorded for rows whose consent column says so, with a source.</Notice></div>
              </Card>
              <div className="flex justify-between"><Button onClick={reset}>Start over</Button><Button variant="primary" loading={busy} onClick={() => void validate()}>Check file</Button></div>
            </>
          )}
        </div>
      )}

      {step === 2 && live && (
        <div className="space-y-4">
          {live.status === 'IMPORTING' ? <Card><Spinner label={`Importing… ${live.importedRows.toLocaleString()} of ${live.validRows.toLocaleString()}`} /></Card> : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Rows read" value={live.totalRows.toLocaleString()} />
                <Stat label="Ready to import" value={live.validRows.toLocaleString()} tone="good" />
                <Stat label="Invalid" value={live.invalidRows.toLocaleString()} tone={live.invalidRows ? 'bad' : 'default'} />
                <Stat label="Duplicates" value={live.duplicateRows.toLocaleString()} hint="In the file or already in your list" />
              </div>
              {(live.invalidRows + live.duplicateRows) > 0 && (
                <Card title={`Problems (${detail.data?.errorCount ?? live.invalidRows + live.duplicateRows})`} actions={<a href={`/api/imports/${live.id}/failed-rows`}><Button size="sm"><Download className="h-4 w-4" />Download failed rows</Button></a>}>
                  <Table>
                    <THead><th className="th">Row</th><th className="th">Type</th><th className="th">Why</th></THead>
                    <TBody>{(detail.data?.errorSample ?? []).map((e) => <tr key={e.id}><td className="td tabular-nums">{e.rowNumber}</td><td className="td"><Badge tone={e.kind === 'INVALID' ? 'red' : 'amber'}>{label(e.kind)}</Badge></td><td className="td text-xs">{e.errors.join('; ')}</td></tr>)}</TBody>
                  </Table>
                  <p className="muted mt-2 text-xs">Showing the first 50. Rows with problems are skipped; fix them in the downloaded file and import it again.</p>
                </Card>
              )}
              <Card title="Preview (first valid rows)">
                {live.preview.length === 0 ? <EmptyState title="No valid rows" /> : (
                  <Table><THead>{['name', 'company', 'phone', 'email', 'country', 'consentStatus'].map((h) => <th key={h} className="th">{label(h)}</th>)}</THead>
                    <TBody>{live.preview.slice(0, 10).map((r, i) => <tr key={i}>{['name', 'company', 'phone', 'email', 'country', 'consentStatus'].map((k) => <td key={k} className="td text-xs">{String(r[k] ?? '—')}</td>)}</tr>)}</TBody></Table>
                )}
              </Card>
              <div className="flex justify-between"><Button onClick={() => { setMapping(live.mapping); setEditing(true); }}>Back to mapping</Button><Button variant="primary" loading={busy} disabled={live.validRows < 1} onClick={() => void commit()}>Import {live.validRows.toLocaleString()} customers</Button></div>
            </>
          )}
        </div>
      )}

      {step === 3 && live && (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <h2 className="text-lg font-semibold">{live.status === 'COMPLETED' ? `${live.importedRows.toLocaleString()} customers imported` : `Import ${live.status.toLowerCase()}`}</h2>
            {live.error && <ErrorBox error={new Error(live.error)} />}
            <div className="flex gap-2"><Link href="/customers"><Button variant="primary">View customers</Button></Link><Button onClick={reset}>Import another file</Button></div>
          </div>
        </Card>
      )}
    </>
  );
}

function ImportHistory() {
  const { data } = useApi<{ imports: { id: string; fileName: string; status: string; totalRows: number; importedRows: number; createdAt: string }[] }>('/api/imports');
  if (!data?.imports.length) return null;
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold">Recent imports</h3>
      <Table><THead><th className="th">File</th><th className="th">Status</th><th className="th">Rows</th><th className="th">When</th></THead>
        <TBody>{data.imports.slice(0, 8).map((i) => <tr key={i.id}><td className="td">{i.fileName}</td><td className="td"><Badge tone={i.status === 'COMPLETED' ? 'green' : i.status === 'FAILED' ? 'red' : 'neutral'}>{label(i.status)}</Badge></td><td className="td tabular-nums">{i.importedRows}/{i.totalRows}</td><td className="td muted text-xs">{fmtDate(i.createdAt)}</td></tr>)}</TBody></Table>
    </div>
  );
}
