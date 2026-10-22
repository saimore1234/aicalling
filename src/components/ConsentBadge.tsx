import { Badge } from '@/components/ui';
import type { Tone } from '@/lib/client/format';

const TONE: Record<string, Tone> = { GRANTED: 'green', DENIED: 'red', WITHDRAWN: 'red', UNKNOWN: 'amber' };
export const ConsentBadge = ({ status }: { status: string }) => <Badge tone={TONE[status] ?? 'neutral'}>{status === 'UNKNOWN' ? 'No consent on record' : status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
