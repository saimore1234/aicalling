import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { customerImports } from '@/db/schema';
import { route } from '@/lib/api';
import { getEnv } from '@/lib/env';
import { ApiError, badRequest } from '@/lib/errors';
import { detectFileType, sniffFile, uploadRoot } from '@/server/imports/reader';
import { suggestMapping } from '@/server/imports/fields';

export const GET = route({ roles: ['ADMIN'] }, async () => {
  const rows = await db
    .select({
      id: customerImports.id,
      fileName: customerImports.fileName,
      fileType: customerImports.fileType,
      status: customerImports.status,
      totalRows: customerImports.totalRows,
      validRows: customerImports.validRows,
      invalidRows: customerImports.invalidRows,
      duplicateRows: customerImports.duplicateRows,
      importedRows: customerImports.importedRows,
      createdAt: customerImports.createdAt,
      completedAt: customerImports.completedAt,
    })
    .from(customerImports)
    .orderBy(desc(customerImports.createdAt))
    .limit(100);
  return { imports: rows };
});

function cleanFileName(name: string): string {
  return path.basename(name).replace(/[\u0000-\u001f<>:"|?*\\/]/g, '_').slice(0, 200) || 'upload';
}

export const POST = route({ roles: ['ADMIN'], rateLimit: { name: 'import-upload', limit: 20, windowSec: 3600, by: 'user' } }, async ({ req, user, audit }) => {
  const maxBytes = getEnv().MAX_UPLOAD_MB * 1024 * 1024;
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > maxBytes + 64 * 1024) throw new ApiError(413, `File is too large (limit ${getEnv().MAX_UPLOAD_MB} MB).`, 'file_too_large');

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest('Expected a multipart/form-data upload with a "file" field.');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('No file was uploaded.');
  if (file.size === 0) throw badRequest('The uploaded file is empty.');
  if (file.size > maxBytes) throw new ApiError(413, `File is too large (limit ${getEnv().MAX_UPLOAD_MB} MB).`, 'file_too_large');

  const buf = Buffer.from(await file.arrayBuffer());
  const type = detectFileType(buf, file.name);
  if (!type) throw badRequest('Only genuine .csv and .xlsx files are accepted.');

  // The stored name is generated server-side; user-supplied names never touch the filesystem path.
  const storedName = `${randomUUID()}.${type}`;
  const dir = path.join(uploadRoot(), 'imports');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const full = path.join(dir, storedName);
  await fs.writeFile(full, buf, { mode: 0o600 });

  try {
    const { headers, sample } = await sniffFile(full, type);
    if (!headers.length) throw badRequest('The file has no header row.');
    const [imp] = await db
      .insert(customerImports)
      .values({
        fileName: cleanFileName(file.name),
        storedName,
        fileSize: file.size,
        fileType: type,
        headers,
        sampleRows: sample,
        mapping: suggestMapping(headers),
        createdById: user.id,
      })
      .returning();
    await audit('customers.import_uploaded', 'customer_import', imp!.id, { file: imp!.fileName, bytes: file.size });
    return Response.json({ import: imp }, { status: 201 });
  } catch (err) {
    await fs.rm(full, { force: true });
    if (err instanceof ApiError) throw err;
    throw badRequest('The file could not be read. Make sure it is a valid CSV or Excel (.xlsx) file.');
  }
});
