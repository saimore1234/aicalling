import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { auditLogs, consentRecords, customerImports, customers, suppressionRecords } from '@/db/schema';
import { GET as importsList, POST as upload } from '@/app/api/imports/route';
import { GET as importGet } from '@/app/api/imports/[id]/route';
import { POST as importValidate } from '@/app/api/imports/[id]/validate/route';
import { POST as importCommit } from '@/app/api/imports/[id]/commit/route';
import { GET as failedRows } from '@/app/api/imports/[id]/failed-rows/route';
import { GET as listCustomers, POST as createCustomer } from '@/app/api/customers/route';
import { DELETE as deleteCustomer, GET as getCustomer, PATCH as patchCustomer } from '@/app/api/customers/[id]/route';
import { POST as archiveCustomer } from '@/app/api/customers/[id]/archive/route';
import { POST as addNote } from '@/app/api/customers/[id]/notes/route';
import { POST as addConsent } from '@/app/api/customers/[id]/consent/route';
import { POST as optOut } from '@/app/api/customers/[id]/opt-out/route';
import { GET as timeline } from '@/app/api/customers/[id]/timeline/route';
import { POST as bulk } from '@/app/api/customers/bulk/route';
import { GET as exportCsv } from '@/app/api/customers/export/route';
import { runCommit, runValidate } from '@/server/imports/run';
import { adminSession, params, req, resetDb, salesSession, shutdown } from '../helpers';

beforeEach(async () => {
  await resetDb();
});
afterAll(shutdown);

function uploadReq(cookie: string, name: string, content: Buffer | string, type = 'text/csv', headers: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set('file', new File([content as BlobPart], name, { type }));
  return new Request('http://localhost:3000/api/imports', { method: 'POST', body: fd, headers: { origin: 'http://localhost:3000', host: 'localhost:3000', cookie, ...headers } });
}

const CSV = [
  'Customer Name,Company,Mobile,Email,Country,Consent,Consent Source,DNC,Product,Notes',
  'Asha Rao,Acme Ltd,98765 43210,asha@acme.com,IN,yes,Web form,no,ERP,Hot lead',
  'Bob Stone,Stone & Co,+44 20 7946 0958,bob@stone.co,GB,,,no,CRM,',
  'Chitra Iyer,Iyer Traders,9123456780,,IN,granted,Signed form,yes,ERP,Asked not to be called',
  ',No Name Ltd,9000000001,x@y.com,IN,,,,,',
  'Dup Person,Dup Ltd,98765 43210,dup@dup.com,IN,,,,,',
  'Bad Phone,Bad Ltd,12345,bad@bad.com,IN,,,,,',
  'Eve Email,Eve Ltd,,eve@eve.com,IN,,,,,',
  'Fay Consent,Fay Ltd,9811122233,fay@fay.com,IN,granted,,,,',
].join('\n');

async function stageImport(cookie: string, csv = CSV, options: Record<string, unknown> = { defaultCountry: 'IN', consentChannels: ['VOICE', 'EMAIL'] }) {
  const up = await upload(uploadReq(cookie, 'leads.csv', csv));
  expect(up.status).toBe(201);
  const { import: imp } = await up.json();
  const v = await importValidate(req(`/api/imports/${imp.id}/validate`, { cookie, body: { mapping: imp.mapping, options } }), params({ id: imp.id }));
  expect(v.status).toBe(200);
  await runValidate(imp.id); // what the worker does
  return imp.id as string;
}

describe('import upload hardening', () => {
  it('accepts a CSV, suggests a mapping and returns headers + samples without exposing the stored filename', async () => {
    const { cookie } = await adminSession();
    const res = await upload(uploadReq(cookie, 'leads.csv', CSV));
    expect(res.status).toBe(201);
    const { import: imp } = await res.json();
    expect(imp.headers).toContain('Mobile');
    expect(imp.mapping['Customer Name']).toBe('name');
    expect(imp.mapping['Mobile']).toBe('phone');
    expect(imp.sampleRows.length).toBeGreaterThan(0);
    const detail = await (await importGet(req(`/api/imports/${imp.id}`, { cookie }), params({ id: imp.id }))).json();
    expect(JSON.stringify(detail)).not.toMatch(/storedName|stored_name/);
  });

  it.each([
    ['wrong extension', 'leads.txt', 'a,b\n1,2'],
    ['executable disguised as csv', 'leads.csv', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])],
    ['fake xlsx (not a zip)', 'leads.xlsx', 'just text pretending'],
    ['empty file', 'leads.csv', ''],
  ])('rejects %s', async (_l, name, content) => {
    const { cookie } = await adminSession();
    const res = await upload(uploadReq(cookie, name, content as Buffer));
    expect(res.status).toBe(400);
  });

  it('rejects oversize uploads declared via content-length', async () => {
    const { cookie } = await adminSession();
    const res = await upload(uploadReq(cookie, 'leads.csv', CSV, 'text/csv', { 'content-length': String(500 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });

  it('neutralises path-traversal file names', async () => {
    const { cookie } = await adminSession();
    const res = await upload(uploadReq(cookie, '../../etc/passwd.csv', CSV));
    expect(res.status).toBe(201);
    const { import: imp } = await res.json();
    expect(imp.fileName).not.toMatch(/\.\.|\//);
  });

  it('is admin-only', async () => {
    const { cookie } = await salesSession();
    expect((await upload(uploadReq(cookie, 'leads.csv', CSV))).status).toBe(403);
    expect((await importsList(req('/api/imports', { cookie }))).status).toBe(403);
  });
});

describe('import validation → preview → commit', () => {
  it('validates every row, classifies problems, and writes nothing before confirmation', async () => {
    const { cookie } = await adminSession();
    const id = await stageImport(cookie);
    const [imp] = await db.select().from(customerImports).where(eq(customerImports.id, id));
    expect(imp!.status).toBe('PREVIEW');
    expect(imp!.totalRows).toBe(8);
    // valid: Asha, Bob, Chitra, Eve  | invalid: no-name, bad-phone, Fay(no consent source) | duplicate: Dup Person (same phone as Asha)
    expect(imp!.validRows).toBe(4);
    expect(imp!.invalidRows).toBe(3);
    expect(imp!.duplicateRows).toBe(1);
    expect(imp!.preview.length).toBe(4);
    expect(await db.select().from(customers)).toHaveLength(0); // preview does not import
  });

  it('commits only after confirmation and records consent, DNC and stage', async () => {
    const { cookie } = await adminSession();
    const id = await stageImport(cookie);
    const res = await importCommit(req(`/api/imports/${id}/commit`, { cookie, method: 'POST' }), params({ id }));
    expect(res.status).toBe(200);
    await runCommit(id);

    const all = await db.select().from(customers);
    expect(all).toHaveLength(4);
    const asha = all.find((c) => c.name === 'Asha Rao')!;
    expect(asha.phone).toBe('+919876543210');
    expect(asha.country).toBe('IN');
    expect(asha.isDemo).toBe(false);

    // consent only where explicitly supplied, for exactly the chosen channels
    const ashaConsent = await db.select().from(consentRecords).where(eq(consentRecords.customerId, asha.id));
    expect(ashaConsent.map((c) => c.channel).sort()).toEqual(['EMAIL', 'VOICE']);
    expect(ashaConsent.every((c) => c.status === 'GRANTED' && c.source === 'Web form')).toBe(true);
    const bob = all.find((c) => c.name === 'Bob Stone')!;
    expect(await db.select().from(consentRecords).where(eq(consentRecords.customerId, bob.id))).toHaveLength(0); // import ≠ consent

    // DNC row flagged + suppressed
    const chitra = all.find((c) => c.name === 'Chitra Iyer')!;
    expect(chitra.doNotCall).toBe(true);
    const sup = await db.select().from(suppressionRecords).where(eq(suppressionRecords.customerId, chitra.id));
    expect(sup).toHaveLength(1);
    expect(sup[0]!.reason).toBe('DNC_REGISTRY');

    const [done] = await db.select().from(customerImports).where(eq(customerImports.id, id));
    expect(done!.status).toBe('COMPLETED');
    expect(done!.importedRows).toBe(4);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, 'customers.import_completed'))).toHaveLength(1);
  });

  it('refuses to commit an unvalidated import and cannot be double-confirmed', async () => {
    const { cookie } = await adminSession();
    const up = await (await upload(uploadReq(cookie, 'leads.csv', CSV))).json();
    const early = await importCommit(req(`/api/imports/${up.import.id}/commit`, { cookie, method: 'POST' }), params({ id: up.import.id }));
    expect(early.status).toBe(409);

    const id = await stageImport(cookie);
    expect((await importCommit(req(`/api/imports/${id}/commit`, { cookie, method: 'POST' }), params({ id }))).status).toBe(200);
    expect((await importCommit(req(`/api/imports/${id}/commit`, { cookie, method: 'POST' }), params({ id }))).status).toBe(409);
  });

  it('detects duplicates against existing customers on a second import and imports nothing twice', async () => {
    const { cookie } = await adminSession();
    const first = await stageImport(cookie);
    await importCommit(req(`/api/imports/${first}/commit`, { cookie, method: 'POST' }), params({ id: first }));
    await runCommit(first);

    const second = await stageImport(cookie);
    const [imp] = await db.select().from(customerImports).where(eq(customerImports.id, second));
    expect(imp!.validRows).toBe(0);
    expect(imp!.duplicateRows).toBe(5); // 4 existing + the in-file duplicate
    const commit = await importCommit(req(`/api/imports/${second}/commit`, { cookie, method: 'POST' }), params({ id: second }));
    expect(commit.status).toBe(400); // nothing valid to import
    expect(await db.select().from(customers)).toHaveLength(4);
  });

  it('rejects an invalid mapping before queueing anything', async () => {
    const { cookie } = await adminSession();
    const up = await (await upload(uploadReq(cookie, 'leads.csv', CSV))).json();
    const res = await importValidate(req(`/api/imports/${up.import.id}/validate`, { cookie, body: { mapping: { 'Customer Name': 'name' }, options: {} } }), params({ id: up.import.id }));
    expect(res.status).toBe(400); // no phone/email column mapped
    const res2 = await importValidate(req(`/api/imports/${up.import.id}/validate`, { cookie, body: { mapping: { 'Nonexistent': 'name', Mobile: 'phone' }, options: {} } }), params({ id: up.import.id }));
    expect(res2.status).toBe(400);
  });

  it('produces a failed-row report with reasons, and sanitises formula injection', async () => {
    const { cookie } = await adminSession();
    const csv = 'Name,Phone,Email\n=EVIL(),12345,a@b.co\nGood Person,9876543210,\n';
    const id = await stageImport(cookie, csv, { defaultCountry: 'IN' });
    const res = await failedRows(req(`/api/imports/${id}/failed-rows`, { cookie }), params({ id }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    const text = await res.text();
    expect(text).toContain('row_number,problem_type,reason');
    expect(text).toMatch(/not a (valid|recognisable) phone/i);
    expect(text).toContain("'=EVIL()"); // neutralised
  });

  it('reads real .xlsx files including numeric phone cells and date consent', async () => {
    const { cookie } = await adminSession();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Customers');
    ws.addRow(['Name', 'Phone', 'Email', 'Consent', 'Consent Source', 'Consent Date']);
    ws.addRow(['Xl Person', 9876501234, 'xl@x.com', 'granted', 'Trade show', new Date('2026-09-01T10:00:00Z')]);
    ws.addRow(['Second Xl', '9876501299', '', '', '', '']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await upload(uploadReq(cookie, 'leads.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    expect(up.status).toBe(201);
    const { import: imp } = await up.json();
    expect(imp.fileType).toBe('xlsx');
    await importValidate(req(`/api/imports/${imp.id}/validate`, { cookie, body: { mapping: imp.mapping, options: { defaultCountry: 'IN' } } }), params({ id: imp.id }));
    await runValidate(imp.id);
    await importCommit(req(`/api/imports/${imp.id}/commit`, { cookie, method: 'POST' }), params({ id: imp.id }));
    await runCommit(imp.id);
    const rows = await db.select().from(customers).where(eq(customers.importId, imp.id));
    expect(rows.map((r) => r.phone).sort()).toEqual(['+919876501234', '+919876501299']);
    const [c] = await db.select().from(consentRecords).where(eq(consentRecords.customerId, rows.find((r) => r.name === 'Xl Person')!.id));
    expect(c!.capturedAt.toISOString()).toBe('2026-09-01T10:00:00.000Z');
  });

  it('streams a large file in chunks (5,000 rows) with correct totals', async () => {
    const { cookie } = await adminSession();
    const lines = ['Name,Phone,Email'];
    for (let i = 0; i < 5000; i++) lines.push(`Person ${i},+9190000${String(i).padStart(5, '0')},p${i}@bulk.example`);
    lines.push('Person 0,+9190000 00000,dupe@bulk.example'); // in-file duplicate of row 1
    lines.push(',+919000099999,'); // invalid: no name
    const id = await stageImport(cookie, lines.join('\n'), { defaultCountry: 'IN' });
    const [imp] = await db.select().from(customerImports).where(eq(customerImports.id, id));
    expect(imp!.totalRows).toBe(5002);
    expect(imp!.validRows).toBe(5000);
    expect(imp!.duplicateRows).toBe(1);
    expect(imp!.invalidRows).toBe(1);
    await importCommit(req(`/api/imports/${id}/commit`, { cookie, method: 'POST' }), params({ id }));
    await runCommit(id);
    expect((await db.select().from(customers)).length).toBe(5000);
  }, 120_000);
});

async function seedCustomers(adminCookie: string, n = 3) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const res = await createCustomer(req('/api/customers', { cookie: adminCookie, body: { name: `Customer ${i}`, phone: `+9198765432${10 + i}`, company: `Co ${i}`, country: 'IN' } }));
    expect(res.status).toBe(201);
    ids.push((await res.json()).customer.id);
  }
  return ids;
}

describe('customer API', () => {
  it('creates with normalisation, rejects duplicates and invalid input', async () => {
    const { cookie } = await adminSession();
    const ok = await createCustomer(req('/api/customers', { cookie, body: { name: 'Zed', phone: '98765 43210', country: 'IN', email: 'ZED@X.COM' } }));
    expect(ok.status).toBe(201);
    const c = (await ok.json()).customer;
    expect(c.phone).toBe('+919876543210');
    expect(c.email).toBe('zed@x.com');
    expect((await createCustomer(req('/api/customers', { cookie, body: { name: 'Zed2', phone: '+919876543210' } }))).status).toBe(409);
    expect((await createCustomer(req('/api/customers', { cookie, body: { name: '', phone: '+919876543211' } }))).status).toBe(400);
    expect((await createCustomer(req('/api/customers', { cookie, body: { name: 'NoContact' } }))).status).toBe(400);
  });

  it('searches, filters and paginates', async () => {
    const { cookie } = await adminSession();
    await seedCustomers(cookie, 7);
    const page1 = await (await listCustomers(req('/api/customers?pageSize=3&page=1&sort=name&dir=asc', { cookie }))).json();
    expect(page1.total).toBe(7);
    expect(page1.customers).toHaveLength(3);
    const page3 = await (await listCustomers(req('/api/customers?pageSize=3&page=3&sort=name&dir=asc', { cookie }))).json();
    expect(page3.customers).toHaveLength(1);
    const q = await (await listCustomers(req('/api/customers?q=Customer%203', { cookie }))).json();
    expect(q.total).toBe(1);
    const none = await (await listCustomers(req('/api/customers?q=nonexistent', { cookie }))).json();
    expect(none.total).toBe(0);
    // LIKE wildcards in the search box are escaped, not interpreted
    const wild = await (await listCustomers(req('/api/customers?q=%25', { cookie }))).json();
    expect(wild.total).toBe(0);
  });

  it('scopes sales executives to their own customers and hides others (404, not 403)', async () => {
    const admin = await adminSession();
    const rep = await salesSession('Rep One');
    const [a, b, c] = await seedCustomers(admin.cookie, 3);
    await bulk(req('/api/customers/bulk', { cookie: admin.cookie, body: { action: 'assign', ids: [a, b], ownerId: rep.user.id } }));
    const mine = await (await listCustomers(req('/api/customers', { cookie: rep.cookie }))).json();
    expect(mine.total).toBe(2);
    expect((await getCustomer(req(`/api/customers/${a}`, { cookie: rep.cookie }), params({ id: a }))).status).toBe(200);
    expect((await getCustomer(req(`/api/customers/${c}`, { cookie: rep.cookie }), params({ id: c }))).status).toBe(404);
    // a rep cannot pass ownerId to peek at other people's data
    const peek = await (await listCustomers(req(`/api/customers?ownerId=none`, { cookie: rep.cookie }))).json();
    expect(peek.total).toBe(2);
  });

  it('lets sales executives change only the pipeline stage of their own leads', async () => {
    const admin = await adminSession();
    const rep = await salesSession();
    const [a] = await seedCustomers(admin.cookie, 1);
    await bulk(req('/api/customers/bulk', { cookie: admin.cookie, body: { action: 'assign', ids: [a], ownerId: rep.user.id } }));
    const edit = await patchCustomer(req(`/api/customers/${a}`, { method: 'PATCH', cookie: rep.cookie, body: { name: 'Hacked' } }), params({ id: a }));
    expect(edit.status).toBe(403);
    const stageRes = await (await (await import('@/app/api/pipeline/stages/route')).GET(req('/api/pipeline/stages', { cookie: rep.cookie }))).json();
    const qualified = stageRes.stages.find((s: { key: string }) => s.key === 'qualified');
    const mv = await patchCustomer(req(`/api/customers/${a}`, { method: 'PATCH', cookie: rep.cookie, body: { stageId: qualified.id } }), params({ id: a }));
    expect(mv.status).toBe(200);
    const [row] = await db.select().from(customers).where(eq(customers.id, a));
    expect(row!.stageId).toBe(qualified.id);
    expect((await deleteCustomer(req(`/api/customers/${a}`, { method: 'DELETE', cookie: rep.cookie }), params({ id: a }))).status).toBe(403);
  });

  it('edits (admin), blocks duplicate phones, archives and soft-deletes', async () => {
    const { cookie } = await adminSession();
    const [a, b] = await seedCustomers(cookie, 2);
    const edit = await patchCustomer(req(`/api/customers/${a}`, { method: 'PATCH', cookie, body: { company: 'New Co', leadScore: 55 } }), params({ id: a }));
    expect(edit.status).toBe(200);
    expect((await edit.json()).customer.company).toBe('New Co');
    const [b0] = await db.select().from(customers).where(eq(customers.id, b));
    const clash = await patchCustomer(req(`/api/customers/${a}`, { method: 'PATCH', cookie, body: { phone: b0!.phone } }), params({ id: a }));
    expect(clash.status).toBe(409);

    await archiveCustomer(req(`/api/customers/${a}/archive`, { cookie, body: { archived: true } }), params({ id: a }));
    expect((await (await listCustomers(req('/api/customers', { cookie }))).json()).total).toBe(1);
    expect((await (await listCustomers(req('/api/customers?archived=only', { cookie }))).json()).total).toBe(1);

    expect((await deleteCustomer(req(`/api/customers/${b}`, { method: 'DELETE', cookie }), params({ id: b }))).status).toBe(200);
    expect((await getCustomer(req(`/api/customers/${b}`, { cookie }), params({ id: b }))).status).toBe(404);
    const [soft] = await db.select().from(customers).where(eq(customers.id, b));
    expect(soft!.deletedAt).not.toBeNull(); // retained for auditability
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, 'customer.deleted'))).toHaveLength(1);
  });

  it('a deleted opted-out customer cannot be re-contacted by re-creating the same number', async () => {
    const { cookie } = await adminSession();
    const [a] = await seedCustomers(cookie, 1);
    const [row] = await db.select().from(customers).where(eq(customers.id, a));
    await optOut(req(`/api/customers/${a}/opt-out`, { cookie, body: { channels: 'ALL' } }), params({ id: a }));
    await deleteCustomer(req(`/api/customers/${a}`, { method: 'DELETE', cookie }), params({ id: a }));
    const again = await createCustomer(req('/api/customers', { cookie, body: { name: 'Re-created', phone: row!.phone!, country: 'IN' } }));
    expect(again.status).toBe(201); // record may be re-created…
    const sup = await db.select().from(suppressionRecords).where(and(eq(suppressionRecords.phone, row!.phone!), isNull(suppressionRecords.liftedAt)));
    expect(sup.length).toBeGreaterThan(0); // …but the number stays suppressed by phone, independent of the customer row
  });

  it('records consent append-only and requires a source', async () => {
    const { cookie } = await adminSession();
    const [a] = await seedCustomers(cookie, 1);
    expect((await addConsent(req(`/api/customers/${a}/consent`, { cookie, body: { channel: 'VOICE', status: 'GRANTED' } }), params({ id: a }))).status).toBe(400);
    for (const status of ['GRANTED', 'WITHDRAWN', 'GRANTED']) {
      const r = await addConsent(req(`/api/customers/${a}/consent`, { cookie, body: { channel: 'VOICE', status, source: 'phone script' } }), params({ id: a }));
      expect(r.status).toBe(201);
    }
    expect(await db.select().from(consentRecords).where(eq(consentRecords.customerId, a))).toHaveLength(3);
    const detail = await (await getCustomer(req(`/api/customers/${a}`, { cookie }), params({ id: a }))).json();
    expect(detail.consent.find((c: { channel: string }) => c.channel === 'VOICE').status).toBe('GRANTED');
    const future = await addConsent(req(`/api/customers/${a}/consent`, { cookie, body: { channel: 'VOICE', status: 'GRANTED', source: 'x', capturedAt: new Date(Date.now() + 86400000).toISOString() } }), params({ id: a }));
    expect(future.status).toBe(400);
  });

  it('opt-out takes effect immediately across every channel', async () => {
    const { cookie } = await adminSession();
    const [a] = await seedCustomers(cookie, 1);
    expect((await optOut(req(`/api/customers/${a}/opt-out`, { cookie, body: { channels: 'ALL', note: 'asked on call' } }), params({ id: a }))).status).toBe(200);
    const [c] = await db.select().from(customers).where(eq(customers.id, a));
    expect(c!.doNotCall).toBe(true);
    expect(c!.lastOutcome).toBe('DO_NOT_CONTACT');
    const cons = await db.select().from(consentRecords).where(eq(consentRecords.customerId, a));
    expect(cons.map((x) => x.channel).sort()).toEqual(['EMAIL', 'SMS', 'VOICE', 'WHATSAPP']);
    expect(cons.every((x) => x.status === 'WITHDRAWN')).toBe(true);
    expect(await db.select().from(suppressionRecords).where(eq(suppressionRecords.customerId, a))).toHaveLength(1);
  });

  it('adds notes and returns a unified timeline', async () => {
    const { cookie } = await adminSession();
    const [a] = await seedCustomers(cookie, 1);
    await addNote(req(`/api/customers/${a}/notes`, { cookie, body: { body: 'Spoke to the CFO' } }), params({ id: a }));
    await addConsent(req(`/api/customers/${a}/consent`, { cookie, body: { channel: 'VOICE', status: 'GRANTED', source: 'web form' } }), params({ id: a }));
    const t = await (await timeline(req(`/api/customers/${a}/timeline`, { cookie }), params({ id: a }))).json();
    expect(t.items.map((i: { type: string }) => i.type).sort()).toEqual(['consent', 'note']);
    expect(t.items[0].at >= t.items[1].at).toBe(true); // newest first
  });

  it('bulk-assigns and exports within the caller\'s scope, and audits the export', async () => {
    const admin = await adminSession();
    const rep = await salesSession('Rep');
    const ids = await seedCustomers(admin.cookie, 4);
    const r = await bulk(req('/api/customers/bulk', { cookie: admin.cookie, body: { action: 'assign', ids: ids.slice(0, 2), ownerId: rep.user.id } }));
    expect((await r.json()).affected).toBe(2);
    expect((await bulk(req('/api/customers/bulk', { cookie: rep.cookie, body: { action: 'assign', ids, ownerId: rep.user.id } }))).status).toBe(403);

    const all = await (await exportCsv(req('/api/customers/export', { cookie: admin.cookie }))).text();
    expect(all.trim().split('\n')).toHaveLength(5); // header + 4
    const mine = await (await exportCsv(req('/api/customers/export', { cookie: rep.cookie }))).text();
    expect(mine.trim().split('\n')).toHaveLength(3); // header + 2 (scoped)
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, 'customer.exported'))).length).toBe(2);
  });
});
