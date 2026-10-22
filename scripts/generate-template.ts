import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { TARGET_FIELDS } from '../src/server/imports/fields';

/** Builds public/templates/customers-template.xlsx — a ready-to-fill workbook with headers, examples and instructions. */
async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VMS Smart Calling';
  const ws = wb.addWorksheet('Customers');
  const headers = ['Customer Name', 'Company', 'Phone', 'Email', 'Country', 'Timezone', 'Language', 'Product Interest', 'Category', 'Lead Source', 'Sales Owner', 'Consent Status', 'Consent Source', 'Consent Date', 'Do Not Call', 'Notes'];
  ws.addRow(headers).font = { bold: true };
  ws.addRow(['Asha Verma', 'Verma Traders', '+12025550143', 'asha.verma@example.com', 'US', 'America/New_York', 'en', 'Solar panels', 'SMB', 'Website form', '', 'granted', 'Website form checkbox', '2026-09-01', 'no', 'EXAMPLE ROW — delete before importing']);
  ws.columns = headers.map((h) => ({ width: Math.max(14, h.length + 4) }));
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 28 }, { width: 100 }];
  help.addRow(['Column', 'Notes']).font = { bold: true };
  const notes: Record<string, string> = {
    name: 'Required.',
    phone: 'International format with +country code (e.g. +14155550123). Numbers without a country code use the default country chosen in the import wizard. A phone or an email is required.',
    email: 'Optional if a phone is given.',
    country: 'Two-letter ISO code (US, IN, GB…). Drives the compliance rules applied before any contact.',
    timezone: 'IANA name such as Asia/Kolkata. Used to respect calling hours.',
    sales_owner: 'Email address of an existing user. Leave blank to leave unassigned.',
    consent_status: 'granted / denied / withdrawn / unknown. Leave blank for unknown. "granted" REQUIRES a consent source — the importer rejects unsupported claims.',
    consent_source: 'How and where the person opted in (form name, event, recording ID).',
    consent_timestamp: 'Date the consent was given. Must not be in the future.',
    do_not_call: 'yes / no. "yes" blocks all calls to this person.',
  };
  for (const f of TARGET_FIELDS) help.addRow([f.label, notes[f.key] ?? '']);
  help.addRow([]);
  help.addRow(['Important', 'Importing a number does NOT give permission to call it. Every call is still checked against consent, do-not-call lists and local calling hours at the moment it is placed.']);

  const out = path.join(process.cwd(), 'public', 'templates', 'customers-template.xlsx');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await wb.xlsx.writeFile(out);
  console.log('Wrote', out);
}
main().catch((e) => { console.error(e); process.exit(1); });
