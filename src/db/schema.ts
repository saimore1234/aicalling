import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const roleEnum = pgEnum('role', ['ADMIN', 'SALES_EXECUTIVE']);
export const channelEnum = pgEnum('channel', ['VOICE', 'SMS', 'EMAIL', 'WHATSAPP']);
export const consentStatusEnum = pgEnum('consent_status', ['UNKNOWN', 'GRANTED', 'DENIED', 'WITHDRAWN']);
export const callStatusEnum = pgEnum('call_status', [
  'QUEUED',
  'INITIATED',
  'RINGING',
  'IN_PROGRESS',
  'COMPLETED',
  'BUSY',
  'NO_ANSWER',
  'FAILED',
  'CANCELED',
]);
export const callOutcomeEnum = pgEnum('call_outcome', [
  'INTERESTED',
  'QUALIFIED',
  'NOT_INTERESTED',
  'CALLBACK_REQUESTED',
  'MEETING_REQUESTED',
  'WRONG_NUMBER',
  'NO_ANSWER',
  'BUSY',
  'FAILED',
  'DO_NOT_CONTACT',
  'HUMAN_REQUIRED',
]);
export const campaignStatusEnum = pgEnum('campaign_status', [
  'DRAFT',
  'RUNNING',
  'PAUSED',
  'STOPPED',
  'COMPLETED',
]);
export const campaignLeadStatusEnum = pgEnum('campaign_lead_status', [
  'PENDING',
  'QUEUED',
  'IN_PROGRESS',
  'RETRY_WAIT',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
  'CANCELED',
]);
export const messageStatusEnum = pgEnum('message_status', [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'BLOCKED',
]);
export const messageDirectionEnum = pgEnum('message_direction', ['OUTBOUND', 'INBOUND']);
export const followUpTypeEnum = pgEnum('follow_up_type', [
  'SEND_EMAIL',
  'SEND_SMS',
  'SEND_WHATSAPP',
  'CREATE_APPOINTMENT',
  'SCHEDULE_CALLBACK',
  'ASSIGN_HUMAN',
  'TASK',
]);
export const followUpStatusEnum = pgEnum('follow_up_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'SKIPPED',
]);
export const appointmentStatusEnum = pgEnum('appointment_status', [
  'REQUESTED',
  'SCHEDULED',
  'COMPLETED',
  'CANCELED',
  'NO_SHOW',
]);
export const importStatusEnum = pgEnum('import_status', [
  'UPLOADED',
  'VALIDATING',
  'PREVIEW',
  'IMPORTING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
]);
export const suppressionReasonEnum = pgEnum('suppression_reason', [
  'CUSTOMER_OPT_OUT',
  'DNC_REGISTRY',
  'WRONG_NUMBER',
  'ADMIN',
  'BOUNCE',
  'UNSUBSCRIBE',
  'PRIVACY_REQUEST',
]);
export const jobStatusEnum = pgEnum('job_status', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED']);
export const privacyRequestTypeEnum = pgEnum('privacy_request_type', ['EXPORT', 'ERASE']);
export const integrationStatusEnum = pgEnum('integration_status', ['NOT_CONFIGURED', 'CONFIGURED', 'OK', 'ERROR']);

/* -------------------------------------------------------------------------- */
/* Shared JSON shapes                                                         */
/* -------------------------------------------------------------------------- */

export type CallWindow = { days: number[]; start: string; end: string }; // days: 1=Mon..7=Sun, HH:mm
export type FaqItem = { question: string; answer: string };
export type PricingItem = { item: string; price: string; currency?: string; note?: string };
export type TranscriptSegment = { role: 'agent' | 'customer' | 'system'; text: string; at: string };

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* -------------------------------------------------------------------------- */
/* Users & sessions                                                           */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull().default('SALES_EXECUTIVE'),
    active: boolean('active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLoginAt: ts('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email), check('users_email_lower', sql`${t.email} = lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_hash_unique').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('prt_token_hash_unique').on(t.tokenHash), index('prt_user_idx').on(t.userId)],
);

/* -------------------------------------------------------------------------- */
/* CRM                                                                        */
/* -------------------------------------------------------------------------- */

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    isWon: boolean('is_won').notNull().default(false),
    isLost: boolean('is_lost').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('pipeline_stages_key_unique').on(t.key)],
);

export const customerImports = pgTable(
  'customer_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileName: text('file_name').notNull(),
    storedName: text('stored_name').notNull(),
    fileSize: integer('file_size').notNull(),
    fileType: text('file_type').notNull(), // csv | xlsx
    status: importStatusEnum('status').notNull().default('UPLOADED'),
    headers: jsonb('headers').$type<string[]>().notNull().default([]),
    sampleRows: jsonb('sample_rows').$type<Record<string, string>[]>().notNull().default([]),
    mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
    options: jsonb('options')
      .$type<{ defaultCountry?: string; consentChannels?: string[]; defaultConsentSource?: string }>()
      .notNull()
      .default({}),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    invalidRows: integer('invalid_rows').notNull().default(0),
    duplicateRows: integer('duplicate_rows').notNull().default(0),
    importedRows: integer('imported_rows').notNull().default(0),
    preview: jsonb('preview').$type<Record<string, unknown>[]>().notNull().default([]),
    error: text('error'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: ts('completed_at'),
  },
  (t) => [index('customer_imports_created_idx').on(t.createdAt)],
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    company: text('company'),
    phone: text('phone'), // normalised E.164
    phoneRaw: text('phone_raw'),
    email: text('email'),
    country: varchar('country', { length: 2 }),
    timezone: text('timezone'),
    language: text('language'),
    productInterest: text('product_interest'),
    category: text('category'),
    leadSource: text('lead_source'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    stageId: uuid('stage_id').references(() => pipelineStages.id, { onDelete: 'set null' }),
    leadScore: integer('lead_score'),
    leadScoreReason: text('lead_score_reason'),
    lastOutcome: callOutcomeEnum('last_outcome'),
    lastContactedAt: ts('last_contacted_at'),
    notes: text('notes'),
    customFields: jsonb('custom_fields').$type<Record<string, string>>().notNull().default({}),
    doNotCall: boolean('do_not_call').notNull().default(false),
    isDemo: boolean('is_demo').notNull().default(false),
    importId: uuid('import_id').references(() => customerImports.id, { onDelete: 'set null' }),
    archivedAt: ts('archived_at'),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('customers_phone_active_unique')
      .on(t.phone)
      .where(sql`${t.deletedAt} is null and ${t.phone} is not null`),
    index('customers_owner_idx').on(t.ownerId),
    index('customers_stage_idx').on(t.stageId),
    index('customers_country_idx').on(t.country),
    index('customers_email_idx').on(t.email),
    index('customers_demo_idx').on(t.isDemo),
    index('customers_created_idx').on(t.createdAt),
    check('customers_contact_required', sql`${t.phone} is not null or ${t.email} is not null`),
  ],
);

export const customerNotes = pgTable(
  'customer_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('customer_notes_customer_idx').on(t.customerId)],
);

export const importRowErrors = pgTable(
  'import_row_errors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: uuid('import_id')
      .notNull()
      .references(() => customerImports.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    kind: text('kind').notNull(), // INVALID | DUPLICATE_IN_FILE | DUPLICATE_EXISTING
    rawData: jsonb('raw_data').$type<Record<string, string>>().notNull(),
    errors: jsonb('errors').$type<string[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('import_row_errors_import_idx').on(t.importId, t.rowNumber)],
);

/* -------------------------------------------------------------------------- */
/* Consent, suppression, country policy                                       */
/* -------------------------------------------------------------------------- */

export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    channel: channelEnum('channel').notNull(),
    status: consentStatusEnum('status').notNull(),
    source: text('source'),
    evidence: text('evidence'),
    capturedAt: ts('captured_at').notNull().defaultNow(),
    recordedById: uuid('recorded_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('consent_customer_channel_idx').on(t.customerId, t.channel, t.capturedAt)],
);

export const suppressionRecords = pgTable(
  'suppression_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: channelEnum('channel'), // null = all channels
    phone: text('phone'),
    email: text('email'),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    reason: suppressionReasonEnum('reason').notNull(),
    source: text('source'),
    note: text('note'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    liftedAt: ts('lifted_at'),
    liftedById: uuid('lifted_by_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('suppression_phone_idx').on(t.phone),
    index('suppression_email_idx').on(t.email),
    index('suppression_customer_idx').on(t.customerId),
    check('suppression_target_required', sql`${t.phone} is not null or ${t.email} is not null or ${t.customerId} is not null`),
  ],
);

export const countryPolicies = pgTable(
  'country_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: varchar('country_code', { length: 2 }).notNull(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    reviewed: boolean('reviewed').notNull().default(false),
    reviewedById: uuid('reviewed_by_id').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: ts('reviewed_at'),
    requireConsentVoice: boolean('require_consent_voice').notNull().default(true),
    requireConsentSms: boolean('require_consent_sms').notNull().default(true),
    requireConsentWhatsapp: boolean('require_consent_whatsapp').notNull().default(true),
    requireConsentEmail: boolean('require_consent_email').notNull().default(true),
    requireDndScrub: boolean('require_dnd_scrub').notNull().default(false),
    dndScrubConfirmedAt: ts('dnd_scrub_confirmed_at'),
    requireDltTemplate: boolean('require_dlt_template').notNull().default(false),
    callWindowStart: text('call_window_start').notNull().default('09:00'),
    callWindowEnd: text('call_window_end').notNull().default('20:00'),
    allowedWeekdays: integer('allowed_weekdays').array().notNull().default(sql`ARRAY[1,2,3,4,5,6]::integer[]`),
    defaultTimezone: text('default_timezone'), // set only for single-timezone countries
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('country_policies_code_unique').on(t.countryCode)],
);

/* -------------------------------------------------------------------------- */
/* AI agents & campaigns                                                      */
/* -------------------------------------------------------------------------- */

export const aiAgents = pgTable(
  'ai_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    companyName: text('company_name').notNull(),
    language: text('language').notNull().default('en'),
    voiceProvider: text('voice_provider').notNull().default('openai'),
    voiceId: text('voice_id').notNull().default('alloy'),
    model: text('model').notNull().default('gpt-realtime'),
    analysisModel: text('analysis_model').notNull().default('gpt-4.1-mini'),
    greeting: text('greeting').notNull(),
    salesScript: text('sales_script').notNull().default(''),
    productKnowledge: text('product_knowledge').notNull().default(''),
    faq: jsonb('faq').$type<FaqItem[]>().notNull().default([]),
    pricing: jsonb('pricing').$type<PricingItem[]>().notNull().default([]),
    salesObjectives: text('sales_objectives').notNull().default(''),
    qualificationQuestions: jsonb('qualification_questions').$type<string[]>().notNull().default([]),
    objectionHandling: text('objection_handling').notNull().default(''),
    maxCallSeconds: integer('max_call_seconds').notNull().default(300),
    escalationRules: text('escalation_rules').notNull().default(''),
    humanTransferNumber: text('human_transfer_number'),
    callbackPolicy: text('callback_policy').notNull().default(''),
    followUpInstructions: text('follow_up_instructions').notNull().default(''),
    responseStyle: text('response_style').notNull().default('Warm, concise and professional.'),
    permittedClaims: text('permitted_claims').notNull().default(''),
    restrictedActions: text('restricted_actions').notNull().default(''),
    transcriptEnabled: boolean('transcript_enabled').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('ai_agents_active_idx').on(t.active)],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    product: text('product'),
    segmentFilter: jsonb('segment_filter').$type<Record<string, unknown>>().notNull().default({}),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => aiAgents.id, { onDelete: 'restrict' }),
    status: campaignStatusEnum('status').notNull().default('DRAFT'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    startAt: ts('start_at'),
    endAt: ts('end_at'),
    callWindows: jsonb('call_windows')
      .$type<CallWindow[]>()
      .notNull()
      .default(sql`'[{"days":[1,2,3,4,5],"start":"10:00","end":"18:00"}]'::jsonb`),
    fallbackTimezone: text('fallback_timezone'),
    maxAttempts: integer('max_attempts').notNull().default(3),
    minIntervalMinutes: integer('min_interval_minutes').notNull().default(240),
    maxConcurrent: integer('max_concurrent').notNull().default(2),
    dailyLimit: integer('daily_limit').notNull().default(100),
    retryOutcomes: jsonb('retry_outcomes').$type<string[]>().notNull().default(sql`'["NO_ANSWER","BUSY"]'::jsonb`),
    isTest: boolean('is_test').notNull().default(false),
    testPhone: text('test_phone'),
    isDemo: boolean('is_demo').notNull().default(true),
    launchConfirmedAt: ts('launch_confirmed_at'),
    launchConfirmedById: uuid('launch_confirmed_by_id').references(() => users.id, { onDelete: 'set null' }),
    launchedAt: ts('launched_at'),
    stoppedAt: ts('stopped_at'),
    stopReason: text('stop_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('campaigns_status_idx').on(t.status), index('campaigns_agent_idx').on(t.agentId)],
);

export const campaignLeads = pgTable(
  'campaign_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    status: campaignLeadStatusEnum('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: ts('last_attempt_at'),
    nextAttemptAt: ts('next_attempt_at'),
    queuedAt: ts('queued_at'),
    lastOutcome: callOutcomeEnum('last_outcome'),
    skipReason: text('skip_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('campaign_leads_unique').on(t.campaignId, t.customerId),
    index('campaign_leads_pick_idx').on(t.campaignId, t.status, t.nextAttemptAt),
    index('campaign_leads_customer_idx').on(t.customerId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Calls                                                                      */
/* -------------------------------------------------------------------------- */

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    campaignLeadId: uuid('campaign_lead_id').references(() => campaignLeads.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => aiAgents.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    providerCallSid: text('provider_call_sid'),
    idempotencyKey: text('idempotency_key').notNull(),
    direction: text('direction').notNull().default('outbound'),
    status: callStatusEnum('status').notNull().default('QUEUED'),
    outcome: callOutcomeEnum('outcome'),
    fromNumber: text('from_number'),
    toNumber: text('to_number').notNull(),
    attemptNumber: integer('attempt_number').notNull().default(1),
    queuedAt: ts('queued_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    answeredAt: ts('answered_at'),
    endedAt: ts('ended_at'),
    durationSeconds: integer('duration_seconds'),
    costAmount: numeric('cost_amount', { precision: 12, scale: 6 }),
    costCurrency: text('cost_currency'),
    endReason: text('end_reason'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    summary: text('summary'),
    transcriptSaved: boolean('transcript_saved').notNull().default(false),
    analyzedAt: ts('analyzed_at'),
    isTest: boolean('is_test').notNull().default(false),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('calls_idempotency_unique').on(t.idempotencyKey),
    uniqueIndex('calls_provider_sid_unique')
      .on(t.providerCallSid)
      .where(sql`${t.providerCallSid} is not null`),
    index('calls_customer_idx').on(t.customerId),
    index('calls_campaign_status_idx').on(t.campaignId, t.status),
    index('calls_status_idx').on(t.status),
    index('calls_created_idx').on(t.createdAt),
  ],
);

export const callEvents = pgTable(
  'call_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    status: text('status'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('call_events_call_idx').on(t.callId, t.occurredAt)],
);

export const transcripts = pgTable(
  'transcripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    segments: jsonb('segments').$type<TranscriptSegment[]>().notNull().default([]),
    fullText: text('full_text').notNull().default(''),
    language: text('language'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('transcripts_call_unique').on(t.callId)],
);

export const leadQualifications = pgTable(
  'lead_qualifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
    outcome: callOutcomeEnum('outcome').notNull(),
    score: integer('score').notNull().default(0),
    reason: text('reason').notNull().default(''),
    evidence: jsonb('evidence').$type<string[]>().notNull().default([]),
    interestLevel: text('interest_level'),
    nextStep: text('next_step'),
    callbackAt: ts('callback_at'),
    meetingPreference: text('meeting_preference'),
    source: text('source').notNull().default('AI'), // AI | HUMAN
    aiModel: text('ai_model'),
    rawOutput: jsonb('raw_output').$type<Record<string, unknown>>(),
    supersedesId: uuid('supersedes_id'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('lead_qual_customer_idx').on(t.customerId, t.createdAt),
    index('lead_qual_call_idx').on(t.callId),
    check('lead_qual_score_range', sql`${t.score} between 0 and 100`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Templates, messages, follow-ups, appointments                              */
/* -------------------------------------------------------------------------- */

export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    channel: channelEnum('channel').notNull(),
    subject: text('subject'),
    bodyText: text('body_text').notNull(),
    bodyHtml: text('body_html'),
    language: text('language').notNull().default('en'),
    isMarketing: boolean('is_marketing').notNull().default(true),
    approved: boolean('approved').notNull().default(false), // provider/DLT approval attested by an admin
    providerTemplateId: text('provider_template_id'), // WhatsApp template name / Twilio Content SID
    dltTemplateId: text('dlt_template_id'),
    dltEntityId: text('dlt_entity_id'),
    attachmentUrls: jsonb('attachment_urls').$type<{ name: string; url: string }[]>().notNull().default([]),
    variables: jsonb('variables').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('message_templates_channel_idx').on(t.channel)],
);

export const followUpRules = pgTable(
  'follow_up_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }), // null = global default
    outcome: callOutcomeEnum('outcome').notNull(),
    action: followUpTypeEnum('action').notNull(),
    templateId: uuid('template_id').references(() => messageTemplates.id, { onDelete: 'set null' }),
    delayMinutes: integer('delay_minutes').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('follow_up_rules_outcome_idx').on(t.outcome, t.active)],
);

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    status: appointmentStatusEnum('status').notNull().default('REQUESTED'),
    title: text('title').notNull(),
    requestedWindow: text('requested_window'),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    location: text('location'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('appointments_customer_idx').on(t.customerId), index('appointments_status_idx').on(t.status, t.startsAt)],
);

export const followUpTasks = pgTable(
  'follow_up_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    ruleId: uuid('rule_id').references(() => followUpRules.id, { onDelete: 'set null' }),
    type: followUpTypeEnum('type').notNull(),
    status: followUpStatusEnum('status').notNull().default('PENDING'),
    templateId: uuid('template_id').references(() => messageTemplates.id, { onDelete: 'set null' }),
    title: text('title'),
    scheduledFor: ts('scheduled_for').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lastError: text('last_error'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    resultMessageId: uuid('result_message_id'),
    resultAppointmentId: uuid('result_appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    assignedToId: uuid('assigned_to_id').references(() => users.id, { onDelete: 'set null' }),
    idempotencyKey: text('idempotency_key').notNull(),
    isDemo: boolean('is_demo').notNull().default(false),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('follow_up_tasks_idem_unique').on(t.idempotencyKey),
    index('follow_up_tasks_due_idx').on(t.status, t.scheduledFor),
    index('follow_up_tasks_customer_idx').on(t.customerId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    channel: channelEnum('channel').notNull(),
    direction: messageDirectionEnum('direction').notNull().default('OUTBOUND'),
    status: messageStatusEnum('status').notNull().default('QUEUED'),
    templateId: uuid('template_id').references(() => messageTemplates.id, { onDelete: 'set null' }),
    callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
    followUpTaskId: uuid('follow_up_task_id').references(() => followUpTasks.id, { onDelete: 'set null' }),
    toAddress: text('to_address').notNull(),
    fromAddress: text('from_address'),
    subject: text('subject'),
    body: text('body').notNull(),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    isMarketing: boolean('is_marketing').notNull().default(true),
    idempotencyKey: text('idempotency_key'),
    sentAt: ts('sent_at'),
    deliveredAt: ts('delivered_at'),
    readAt: ts('read_at'),
    failedAt: ts('failed_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('messages_idem_unique')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('messages_customer_idx').on(t.customerId, t.createdAt),
    index('messages_provider_id_idx').on(t.provider, t.providerMessageId),
    index('messages_status_idx').on(t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* Platform                                                                   */
/* -------------------------------------------------------------------------- */

export const integrationConfigurations = pgTable(
  'integration_configurations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(), // app | openai | twilio | email | sms | whatsapp
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}), // NON-secret settings only
    status: integrationStatusEnum('status').notNull().default('NOT_CONFIGURED'),
    lastCheckedAt: ts('last_checked_at'),
    lastError: text('last_error'),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('integration_key_unique').on(t.key)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    userEmail: text('user_email'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_created_idx').on(t.createdAt),
    index('audit_user_idx').on(t.userId),
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_action_idx').on(t.action),
  ],
);

export const backgroundJobs = pgTable(
  'background_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queue: text('queue').notNull(),
    jobId: text('job_id').notNull(),
    name: text('name').notNull(),
    status: jobStatusEnum('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    relatedType: text('related_type'),
    relatedId: text('related_id'),
    error: text('error'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('background_jobs_queue_job_unique').on(t.queue, t.jobId),
    index('background_jobs_status_idx').on(t.status, t.updatedAt),
  ],
);

export const webhookReceipts = pgTable(
  'webhook_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    eventKey: text('event_key').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('webhook_receipts_unique').on(t.provider, t.eventKey)],
);

export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id'), // intentionally no FK: survives erasure
    customerRef: text('customer_ref'),
    type: privacyRequestTypeEnum('type').notNull(),
    status: text('status').notNull().default('COMPLETED'),
    requestedById: uuid('requested_by_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: createdAt(),
    completedAt: ts('completed_at'),
  },
  (t) => [index('privacy_requests_created_idx').on(t.createdAt)],
);
