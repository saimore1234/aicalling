'use client';
import { useApi } from '@/lib/client/fetcher';

export type Stage = { id: string; key: string; name: string; position: number; isWon: boolean; isLost: boolean; active: boolean };
export type UserLite = { id: string; name: string; role: string; email?: string; active?: boolean };

export const useStages = () => useApi<{ stages: Stage[] }>('/api/pipeline/stages');
export const useUsers = () => useApi<{ users: UserLite[] }>('/api/users');
