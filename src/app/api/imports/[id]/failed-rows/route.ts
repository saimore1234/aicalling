import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customerImports } from '@/db/schema';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { failedRowsCsv } from '@/server/imports/run';

export const GET = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params }) => {
  const [imp] = await db.select({ id: customerImports.id, fileName: customerImports.fileName }).from(customerImports).where(eq(customerImports.id, params.id)).limit(1);
  if (!imp) throw notFound('Import not found');
  const csv = await failedRowsCsv(imp.id);
  const base = imp.fileName.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}-failed-rows.csv"`, 'Cache-Control': 'no-store' } });
});
