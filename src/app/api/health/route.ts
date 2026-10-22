import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/** Unauthenticated liveness/readiness probe for load balancers and Docker. Reveals nothing beyond up/down. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
