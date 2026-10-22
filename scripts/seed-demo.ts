import { and, eq, isNull } from 'drizzle-orm';
import { closeDb, db } from '../src/db/client';
import { aiAgents, campaigns, consentRecords, customers, pipelineStages } from '../src/db/schema';
import { STARTER_AGENT } from '../src/server/agent-validation';
import { populateLeads } from '../src/server/campaigns';
import { seedBaseline } from '../src/server/seed';

/**
 * Creates clearly-labelled DEMO data: fictional people on reserved fictional phone numbers (US 555-01xx),
 * a fictional company, a demo AI agent and one DRAFT demo campaign. Everything is flagged is_demo = true and
 * is shown with a DEMO badge in the UI. Nothing here can reach a real person. Safe to run more than once.
 */
const FIRST = ['Asha', 'Ravi', 'Meera', 'Daniel', 'Priya', 'Omar', 'Lena', 'Kavya', 'Tomas', 'Sana', 'Ian', 'Nikhil', 'Zoe', 'Arjun', 'Maya', 'Peter', 'Isha', 'Carlos', 'Anita', 'Victor', 'Neha', 'Samir', 'Julia', 'Dev'];
const LAST = ['Verma', 'Mehta', 'Iyer', 'Okoye', 'Nair', 'Haddad', 'Fischer', 'Rao', 'Novak', 'Khan', 'Brooks', 'Shah', 'Lindgren', 'Patel', 'Rossi', 'Clarke', 'Bose', 'Silva', 'Kapoor', 'Moreau', 'Reddy', 'Qureshi', 'Santos', 'Menon'];
const BIZ = ['Traders', 'Logistics', 'Textiles', 'Foods', 'Pharma', 'Motors', 'Builders', 'Retail', 'Agro', 'Print'];
const STAGE_KEYS = ['new', 'new', 'new', 'contacted', 'contacted', 'qualified', 'meeting_scheduled', 'proposal'];

async function main() {
  await seedBaseline();
  const stages = await db.select().from(pipelineStages);
  const stageId = (k: string) => stages.find((s) => s.key === k)?.id ?? null;

  const existing = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.isDemo, true), isNull(customers.deletedAt))).limit(1);
  if (existing.length) {
    console.log('Demo customers already exist — leaving them as they are.');
  } else {
    for (let i = 0; i < FIRST.length; i++) {
      const phone = `+1202555${String(100 + i).padStart(4, '0')}`;
      const [c] = await db.insert(customers).values({
        name: `${FIRST[i]} ${LAST[i]}`,
        company: `${LAST[i]} ${BIZ[i % BIZ.length]} (demo)`,
        phone, phoneRaw: phone,
        email: `demo.${i + 1}@example.invalid`,
        country: 'US', timezone: 'America/New_York', language: 'en',
        productInterest: i % 2 ? 'Fleet tracking' : 'Solar panels',
        category: 'Demo', leadSource: 'DEMO DATA',
        stageId: stageId(STAGE_KEYS[i % STAGE_KEYS.length]!),
        isDemo: true,
        notes: 'Fictional demo record. Not a real person.',
      }).returning({ id: customers.id });
      await db.insert(consentRecords).values({ customerId: c!.id, channel: 'VOICE', status: 'GRANTED', source: 'DEMO seed (simulated consent)', evidence: 'Fictional record' });
    }
    console.log(`Created ${FIRST.length} DEMO customers.`);
  }

  let [agent] = await db.select().from(aiAgents).where(and(eq(aiAgents.name, 'Demo sales assistant'), isNull(aiAgents.deletedAt))).limit(1);
  if (!agent) {
    [agent] = await db.insert(aiAgents).values({
      ...STARTER_AGENT,
      name: 'Demo sales assistant',
      companyName: 'Sunrise Demo Co (fictional)',
      productKnowledge: 'Sunrise Demo Co is a fictional company used for demonstrations. It sells rooftop solar panels and fleet-tracking devices to small businesses. All details in this demo are invented and no real offer exists.',
      faq: [{ question: 'Is this a real offer?', answer: 'No. This is a demonstration with fictional data.' }],
    }).returning();
    console.log('Created demo AI agent.');
  }

  const [camp] = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.name, 'Demo campaign'), isNull(campaigns.deletedAt))).limit(1);
  if (!camp) {
    const [row] = await db.insert(campaigns).values({
      name: 'Demo campaign', product: 'Solar panels', agentId: agent!.id, isDemo: true, segmentFilter: { country: 'US' },
      maxConcurrent: 2, dailyLimit: 50, fallbackTimezone: 'America/New_York',
      callWindows: [{ days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' }],
    }).returning();
    const { added } = await populateLeads(row!);
    console.log(`Created DRAFT demo campaign with ${added} queued customers. Open it, check readiness, and press Start (system must be in DEMO mode).`);
  }
}

main().catch((e) => { console.error('Demo seed failed:', e.message); process.exitCode = 1; }).finally(closeDb);
