import { z } from 'zod';

export const OUTCOMES = [
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
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Outcomes the AI may assign from a transcript (telephony outcomes like BUSY/FAILED come from call status). */
export const AI_OUTCOMES = [
  'INTERESTED',
  'QUALIFIED',
  'NOT_INTERESTED',
  'CALLBACK_REQUESTED',
  'MEETING_REQUESTED',
  'WRONG_NUMBER',
  'NO_ANSWER',
  'DO_NOT_CONTACT',
  'HUMAN_REQUIRED',
] as const;

export const QualificationSchema = z.object({
  outcome: z.enum(AI_OUTCOMES),
  score: z.coerce.number().int().min(0).max(100),
  interest_level: z.enum(['none', 'low', 'medium', 'high']),
  reason: z.string().min(1).max(1500),
  evidence: z.array(z.string().max(500)).max(10),
  next_step: z.string().max(500).nullable(),
  callback_at: z
    .string()
    .nullable()
    .refine((v) => v === null || !Number.isNaN(Date.parse(v)), 'callback_at must be an ISO 8601 date-time'),
  meeting_preference: z.string().max(500).nullable(),
  opt_out_requested: z.boolean(),
  human_requested: z.boolean(),
  summary: z.string().min(1).max(2000),
});
export type Qualification = z.infer<typeof QualificationSchema>;

/** JSON Schema (OpenAI strict structured-outputs dialect) mirroring QualificationSchema. */
export const QUALIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'outcome',
    'score',
    'interest_level',
    'reason',
    'evidence',
    'next_step',
    'callback_at',
    'meeting_preference',
    'opt_out_requested',
    'human_requested',
    'summary',
  ],
  properties: {
    outcome: { type: 'string', enum: [...AI_OUTCOMES] },
    score: { type: 'integer', description: '0-100 likelihood the lead converts' },
    interest_level: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    reason: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    next_step: { type: ['string', 'null'] },
    callback_at: { type: ['string', 'null'], description: 'ISO 8601 with offset, or null' },
    meeting_preference: { type: ['string', 'null'] },
    opt_out_requested: { type: 'boolean' },
    human_requested: { type: 'boolean' },
    summary: { type: 'string' },
  },
} as const;
