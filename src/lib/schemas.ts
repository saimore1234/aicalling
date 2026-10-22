import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
export const passwordSchema = z.string().min(12, 'Password must be at least 12 characters').max(200);
export const uuidSchema = z.string().uuid();

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

export const channelSchema = z.enum(['VOICE', 'SMS', 'EMAIL', 'WHATSAPP']);
export const outcomeSchema = z.enum([
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
