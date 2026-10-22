export function fmtDate(v: string | Date | null | undefined, opts: { time?: boolean } = { time: true }): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, opts.time === false ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' });
}
export function fmtDuration(s: number | null | undefined): string {
  if (s === null || s === undefined) return '—';
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
export function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}
export function fmtNum(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toLocaleString();
}
export const OUTCOME_LABEL: Record<string, string> = {
  INTERESTED: 'Interested', QUALIFIED: 'Qualified', NOT_INTERESTED: 'Not interested', CALLBACK_REQUESTED: 'Callback requested',
  MEETING_REQUESTED: 'Meeting requested', WRONG_NUMBER: 'Wrong number', NO_ANSWER: 'No answer', BUSY: 'Busy', FAILED: 'Failed',
  DO_NOT_CONTACT: 'Do not contact', HUMAN_REQUIRED: 'Needs human', PENDING_ANALYSIS: 'Analysing…',
};
export type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'purple';
export const OUTCOME_TONE: Record<string, Tone> = {
  INTERESTED: 'green', QUALIFIED: 'green', MEETING_REQUESTED: 'green', CALLBACK_REQUESTED: 'blue', HUMAN_REQUIRED: 'purple',
  NOT_INTERESTED: 'neutral', NO_ANSWER: 'neutral', BUSY: 'neutral', WRONG_NUMBER: 'amber', FAILED: 'red', DO_NOT_CONTACT: 'red', PENDING_ANALYSIS: 'amber',
};
export const label = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');
