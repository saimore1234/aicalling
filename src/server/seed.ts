import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { countryPolicies, followUpRules, messageTemplates, pipelineStages } from '@/db/schema';

export const DEFAULT_STAGES = [
  { key: 'new', name: 'New', position: 1 },
  { key: 'contacted', name: 'Contacted', position: 2 },
  { key: 'qualified', name: 'Qualified', position: 3 },
  { key: 'meeting_scheduled', name: 'Meeting Scheduled', position: 4 },
  { key: 'proposal', name: 'Proposal', position: 5 },
  { key: 'won', name: 'Won', position: 6, isWon: true },
  { key: 'lost', name: 'Lost', position: 7, isLost: true },
];

/**
 * STARTING POINTS ONLY. Every policy is seeded reviewed=false, which blocks all LIVE contact for that
 * country until an administrator reviews it against current local law (see docs/COMPLIANCE.md).
 */
export const DEFAULT_POLICIES = [
  {
    countryCode: 'IN',
    name: 'India',
    requireDndScrub: true,
    requireDltTemplate: true,
    callWindowStart: '09:00',
    callWindowEnd: '21:00',
    allowedWeekdays: [1, 2, 3, 4, 5, 6, 7],
    defaultTimezone: 'Asia/Kolkata',
    notes:
      'TRAI TCCCPR framework: register as a sender (entity/headers/templates on DLT), scrub against the NDNC/preference register, keep verifiable consent, and use only telecom resources permitted for promotional voice/SMS. Promotional contact is limited to 09:00–21:00. Confirm current requirements with your telecom provider and counsel.',
  },
  {
    countryCode: 'US',
    name: 'United States',
    requireDndScrub: true,
    requireDltTemplate: false,
    callWindowStart: '08:00',
    callWindowEnd: '21:00',
    allowedWeekdays: [1, 2, 3, 4, 5, 6, 7],
    defaultTimezone: null,
    notes:
      'TCPA/TSR: telemarketing calls 08:00–21:00 recipient-local time; scrub the National Do-Not-Call Registry; AI-generated voices are treated as artificial voices, which generally requires prior express written consent. State laws may be stricter. Confirm with counsel.',
  },
  {
    countryCode: 'GB',
    name: 'United Kingdom',
    requireDndScrub: true,
    requireDltTemplate: false,
    callWindowStart: '09:00',
    callWindowEnd: '20:00',
    allowedWeekdays: [1, 2, 3, 4, 5, 6],
    defaultTimezone: 'Europe/London',
    notes: 'PECR/UK GDPR: screen against the TPS/CTPS; automated marketing calls require specific prior consent; identify the caller. Confirm with counsel.',
  },
  {
    countryCode: 'AE',
    name: 'United Arab Emirates',
    requireDndScrub: true,
    requireDltTemplate: false,
    callWindowStart: '09:00',
    callWindowEnd: '20:00',
    allowedWeekdays: [1, 2, 3, 4, 5, 6, 7],
    defaultTimezone: 'Asia/Dubai',
    notes: 'TDRA telemarketing rules: honour the Do-Not-Call registry and sender registration. Verify the permitted hours and consent rules for your use case.',
  },
];

export async function seedBaseline() {
  for (const s of DEFAULT_STAGES) {
    await db.insert(pipelineStages).values(s).onConflictDoNothing({ target: pipelineStages.key });
  }
  for (const p of DEFAULT_POLICIES) {
    await db.insert(countryPolicies).values({ ...p, reviewed: false }).onConflictDoNothing({ target: countryPolicies.countryCode });
  }

  const templates = [
    {
      name: 'Product information (email)',
      channel: 'EMAIL' as const,
      subject: 'Information about {{product}} from {{company_name}}',
      bodyText:
        'Hello {{first_name}},\n\nThank you for speaking with us. As discussed, here is some information about {{product}}.\n\nA member of our team will be in touch to answer any questions.\n\nKind regards,\n{{company_name}}',
      bodyHtml:
        '<p>Hello {{first_name}},</p><p>Thank you for speaking with us. As discussed, here is some information about <strong>{{product}}</strong>.</p><p>A member of our team will be in touch to answer any questions.</p><p>Kind regards,<br/>{{company_name}}</p>',
      isMarketing: true,
      approved: true,
      variables: ['first_name', 'product', 'company_name'],
    },
    {
      name: 'Meeting request received (email)',
      channel: 'EMAIL' as const,
      subject: 'We received your meeting request',
      bodyText: 'Hello {{first_name}},\n\nThanks for your interest. Our sales team will contact you shortly to confirm a time for your demonstration.\n\n{{company_name}}',
      bodyHtml: '<p>Hello {{first_name}},</p><p>Thanks for your interest. Our sales team will contact you shortly to confirm a time for your demonstration.</p><p>{{company_name}}</p>',
      isMarketing: false,
      approved: true,
      variables: ['first_name', 'company_name'],
    },
    {
      name: 'Follow-up SMS',
      channel: 'SMS' as const,
      subject: null,
      bodyText: 'Hi {{first_name}}, thanks for speaking with {{company_name}}. Reply STOP to opt out.',
      bodyHtml: null,
      isMarketing: true,
      approved: false, // requires provider/DLT approval attested by an admin
      variables: ['first_name', 'company_name'],
    },
    {
      name: 'WhatsApp follow-up',
      channel: 'WHATSAPP' as const,
      subject: null,
      bodyText: 'Hi {{first_name}}, thanks for speaking with {{company_name}} about {{product}}.',
      bodyHtml: null,
      isMarketing: true,
      approved: false, // must be a Meta-approved template; set providerTemplateId then approve
      variables: ['first_name', 'product'],
    },
  ];
  for (const t of templates) {
    const [existing] = await db.select({ id: messageTemplates.id }).from(messageTemplates).where(eq(messageTemplates.name, t.name)).limit(1);
    if (!existing) await db.insert(messageTemplates).values(t);
  }

  const [info] = await db.select().from(messageTemplates).where(eq(messageTemplates.name, 'Product information (email)')).limit(1);
  const [meet] = await db.select().from(messageTemplates).where(eq(messageTemplates.name, 'Meeting request received (email)')).limit(1);
  const existingRules = await db.select({ id: followUpRules.id }).from(followUpRules).limit(1);
  if (!existingRules.length) {
    await db.insert(followUpRules).values([
      { name: 'Interested → send product information', outcome: 'INTERESTED', action: 'SEND_EMAIL', templateId: info?.id ?? null, delayMinutes: 5 },
      { name: 'Qualified → assign to a sales executive', outcome: 'QUALIFIED', action: 'ASSIGN_HUMAN', delayMinutes: 0 },
      { name: 'Qualified → send product information', outcome: 'QUALIFIED', action: 'SEND_EMAIL', templateId: info?.id ?? null, delayMinutes: 5 },
      { name: 'Meeting requested → create appointment request', outcome: 'MEETING_REQUESTED', action: 'CREATE_APPOINTMENT', delayMinutes: 0 },
      { name: 'Meeting requested → acknowledge by email', outcome: 'MEETING_REQUESTED', action: 'SEND_EMAIL', templateId: meet?.id ?? null, delayMinutes: 2 },
      { name: 'Callback requested → schedule callback', outcome: 'CALLBACK_REQUESTED', action: 'SCHEDULE_CALLBACK', delayMinutes: 0 },
      { name: 'Human requested → assign to a sales executive', outcome: 'HUMAN_REQUIRED', action: 'ASSIGN_HUMAN', delayMinutes: 0 },
    ]);
  }
}
