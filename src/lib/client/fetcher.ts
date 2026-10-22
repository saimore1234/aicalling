'use client';
import useSWR, { type SWRConfiguration } from 'swr';

export class ApiClientError extends Error {
  constructor(public status: number, message: string, public code?: string, public fieldErrors?: Record<string, string[]>, public details?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'), credentials: 'same-origin', signal: opts.signal };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(url, init);
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    if (res.status === 403 && data?.code === 'password_change_required' && typeof window !== 'undefined' && !location.pathname.startsWith('/account')) {
      location.href = '/account?forced=1';
    }
    throw new ApiClientError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code, data?.fieldErrors, data?.details);
  }
  return data as T;
}

export const fetcher = <T,>(url: string) => api<T>(url);

export function useApi<T>(url: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T, ApiClientError>(url, fetcher<T>, { revalidateOnFocus: false, ...config });
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}
