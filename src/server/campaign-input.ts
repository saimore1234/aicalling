import { z } from 'zod';
import { isValidTimezone } from '@/lib/tz';
import { segmentSchema } from './campaigns';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
export const callWindowSchema = z.object({
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  start: hhmm,
  end: hhmm,
}).refine((w) => w.start < w.end, { message: 'Window end must be after start' });

export const campaignBody = z.object({
  name: z.string().trim().min(1).max(160),
  product: z.string().trim().max(200).nullable().optional(),
  segmentFilter: segmentSchema.default({}),
  agentId: z.string().uuid(),
  startAt: z.coerce.date().nullable().optional(),
  endAt: z.coerce.date().nullable().optional(),
  callWindows: z.array(callWindowSchema).min(1).max(14).default([{ days: [1, 2, 3, 4, 5], start: '10:00', end: '18:00' }]),
  fallbackTimezone: z.string().refine((v) => isValidTimezone(v), 'Unknown IANA timezone').nullable().optional(),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(3),
  minIntervalMinutes: z.coerce.number().int().min(15).max(10080).default(240),
  maxConcurrent: z.coerce.number().int().min(1).max(50).default(2),
  dailyLimit: z.coerce.number().int().min(1).max(10000).default(100),
  retryOutcomes: z.array(z.enum(['NO_ANSWER', 'BUSY', 'FAILED'])).default(['NO_ANSWER', 'BUSY']),
  isTest: z.boolean().default(false),
  testPhone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use E.164 format').nullable().optional(),
}).refine((c) => !c.startAt || !c.endAt || c.startAt < c.endAt, { message: 'End must be after start', path: ['endAt'] });
export const campaignPatch = campaignBody.innerType().partial();
