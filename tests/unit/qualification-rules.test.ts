import { describe, expect, it } from 'vitest';
import { enforceBusinessRules } from '@/server/qualification';
import { QualificationSchema, type Qualification } from '@/server/qualification-schema';

const base: Qualification = {
  outcome: 'INTERESTED', score: 70, interest_level: 'high', reason: 'r', evidence: ['I am interested in solar'], next_step: null, callback_at: null,
  meeting_preference: null, opt_out_requested: false, human_requested: false, summary: 's',
};
const now = new Date('2026-06-01T10:00:00Z');
const T = 'Agent: Hello\nCustomer: I am interested in solar panels for my shop';

describe('QualificationSchema', () => {
  it('accepts a valid object and coerces numeric strings', () => {
    expect(QualificationSchema.safeParse({ ...base, score: '55' }).success).toBe(true);
  });
  it.each([
    ['unknown outcome', { outcome: 'GREAT' }],
    ['score above 100', { score: 101 }],
    ['negative score', { score: -1 }],
    ['bad interest level', { interest_level: 'extreme' }],
    ['unparseable date', { callback_at: 'next tuesday-ish' }],
    ['missing summary', { summary: undefined }],
  ])('rejects %s', (_n, patch) => {
    expect(QualificationSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
  it('rejects extra-field-free but missing required fields', () => {
    expect(QualificationSchema.safeParse({ outcome: 'INTERESTED' }).success).toBe(false);
  });
});

describe('enforceBusinessRules', () => {
  it('opt-out overrides every other outcome and zeroes the score', () => {
    const r = enforceBusinessRules({ ...base, outcome: 'MEETING_REQUESTED', opt_out_requested: true }, { transcript: T, now });
    expect(r.outcome).toBe('DO_NOT_CONTACT');
    expect(r.score).toBe(0);
    expect(r.notes.join(' ')).toMatch(/overridden/);
  });
  it('a request for a human escalates a positive outcome', () => {
    expect(enforceBusinessRules({ ...base, human_requested: true }, { transcript: T, now }).outcome).toBe('HUMAN_REQUIRED');
  });
  it('downgrades a positive outcome whose evidence is not in the transcript', () => {
    const r = enforceBusinessRules({ ...base, evidence: ['I will buy ten units today'] }, { transcript: T, now });
    expect(r.outcome).toBe('HUMAN_REQUIRED');
    expect(r.score).toBeLessThanOrEqual(40);
  });
  it('treats a transcript with no customer speech as NO_ANSWER', () => {
    const r = enforceBusinessRules({ ...base }, { transcript: 'Agent: Hello?', now });
    expect(r.outcome).toBe('NO_ANSWER');
    expect(r.score).toBe(0);
  });
  it('keeps a well-evidenced outcome unchanged', () => {
    const r = enforceBusinessRules({ ...base }, { transcript: T, now });
    expect(r.outcome).toBe('INTERESTED');
    expect(r.score).toBe(70);
  });
  it('ignores callback times in the past or more than a year away', () => {
    const t = { transcript: T, now };
    expect(enforceBusinessRules({ ...base, outcome: 'CALLBACK_REQUESTED', evidence: [], callback_at: '2026-05-01T10:00:00Z' }, t).callbackAt).toBeNull();
    expect(enforceBusinessRules({ ...base, outcome: 'CALLBACK_REQUESTED', evidence: [], callback_at: '2028-01-01T10:00:00Z' }, t).callbackAt).toBeNull();
    expect(enforceBusinessRules({ ...base, outcome: 'CALLBACK_REQUESTED', evidence: [], callback_at: '2026-06-02T10:00:00Z' }, t).callbackAt?.toISOString()).toBe('2026-06-02T10:00:00.000Z');
  });
});
