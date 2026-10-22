import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);

export const agentBody = z.object({
  name: text(120).min(1),
  companyName: text(160).min(1),
  language: text(20).min(2).default('en'),
  voiceId: text(60).min(1).default('alloy'),
  model: text(80).min(1).default('gpt-realtime'),
  analysisModel: text(80).min(1).default('gpt-4.1-mini'),
  greeting: text(1000).min(1),
  salesScript: text(8000).default(''),
  productKnowledge: text(30000).default(''),
  faq: z.array(z.object({ question: text(500).min(1), answer: text(2000).min(1) })).max(100).default([]),
  pricing: z.array(z.object({ item: text(200).min(1), price: text(100).min(1), currency: text(10).optional(), note: text(300).optional() })).max(200).default([]),
  salesObjectives: text(3000).default(''),
  qualificationQuestions: z.array(text(300).min(1)).max(20).default([]),
  objectionHandling: text(5000).default(''),
  maxCallSeconds: z.coerce.number().int().min(30).max(1800).default(300),
  escalationRules: text(3000).default(''),
  humanTransferNumber: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'Use E.164 format, e.g. +14155550123').nullable().optional(),
  callbackPolicy: text(2000).default(''),
  followUpInstructions: text(2000).default(''),
  responseStyle: text(1000).default('Warm, concise and professional.'),
  permittedClaims: text(3000).default(''),
  restrictedActions: text(3000).default(''),
  transcriptEnabled: z.boolean().default(true),
  active: z.boolean().default(true),
});
export const agentPatch = agentBody.partial();
export type AgentBody = z.infer<typeof agentBody>;
