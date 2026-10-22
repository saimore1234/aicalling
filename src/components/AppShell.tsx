'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  BarChart3, Bot, CalendarCheck, FileText, GitBranch, History, LogOut, Megaphone, Menu, PhoneCall, Plug, ScrollText,
  ShieldCheck, Upload, UserCog, Users, X, Workflow, Activity, OctagonAlert,
} from 'lucide-react';
import { Spinner } from '@/components/ui';
import { api, useApi } from '@/lib/client/fetcher';

export type Me = { id: string; email: string; name: string; role: 'ADMIN' | 'SALES_EXECUTIVE'; mustChangePassword: boolean };
type Ctx = { me: Me; mode: 'demo' | 'live'; killSwitch: boolean; isAdmin: boolean; refresh: () => void };
const MeCtx = createContext<Ctx | null>(null);
export const useMe = () => {
  const c = useContext(MeCtx);
  if (!c) throw new Error('useMe outside AppShell');
  return c;
};

type NavItem = { href: string; label: string; icon: typeof BarChart3; admin?: boolean };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Sell', items: [
    { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
    { href: '/customers', label: 'Customers', icon: Users },
    { href: '/pipeline', label: 'Pipeline', icon: GitBranch },
    { href: '/calls', label: 'Call history', icon: History },
    { href: '/appointments', label: 'Appointments', icon: CalendarCheck },
    { href: '/followups', label: 'Follow-ups', icon: Workflow },
  ] },
  { group: 'Automate', items: [
    { href: '/campaigns', label: 'Campaigns', icon: Megaphone, admin: true },
    { href: '/agents', label: 'AI agents', icon: Bot, admin: true },
    { href: '/templates', label: 'Templates', icon: FileText },
    { href: '/import', label: 'Import customers', icon: Upload, admin: true },
  ] },
  { group: 'Govern', items: [
    { href: '/compliance', label: 'Compliance', icon: ShieldCheck, admin: true },
    { href: '/integrations', label: 'Integrations', icon: Plug, admin: true },
    { href: '/users', label: 'Users & roles', icon: UserCog, admin: true },
    { href: '/audit', label: 'Audit log', icon: ScrollText, admin: true },
    { href: '/system', label: 'System health', icon: Activity, admin: true },
  ] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data, error, mutate } = useApi<{ user: Me; mode: 'demo' | 'live'; killSwitch: boolean }>('/api/auth/me', { refreshInterval: 30_000 });
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  if (error && error.status !== 401) return <div className="p-8 text-center text-sm">Could not load your session: {error.message}</div>;
  if (!data) return <Spinner />;
  const { user, mode, killSwitch } = data;
  const isAdmin = user.role === 'ADMIN';
  const items = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.admin || isAdmin) })).filter((g) => g.items.length);

  const nav = (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {items.map((g) => (
        <div key={g.group}>
          <p className="muted mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider">{g.group}</p>
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const active = path === i.href || path.startsWith(`${i.href}/`);
              return (
                <li key={i.href}>
                  <Link href={i.href} aria-current={active ? 'page' : undefined}
                    className={clsx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium', active ? 'bg-brand-600 text-white' : 'hover:bg-[rgb(var(--surface-2))]')}>
                    <i.icon className="h-4 w-4 shrink-0" />{i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  async function logout() {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    window.location.href = '/login';
  }

  return (
    <MeCtx.Provider value={{ me: user, mode, killSwitch, isAdmin, refresh: () => void mutate() }}>
      <div className="flex min-h-screen">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-[rgb(var(--border))] bg-[rgb(var(--surface))] lg:flex">
          <Brand />
          {nav}
          <UserBox user={user} onLogout={logout} />
        </aside>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-[rgb(var(--surface))] shadow-xl">
              <div className="flex items-center justify-between pr-3"><Brand /><button aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button></div>
              {nav}
              <UserBox user={user} onLogout={logout} />
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[rgb(var(--border))] bg-[rgb(var(--surface))]/95 px-4 py-2.5 backdrop-blur lg:px-6">
            <button className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
            <div className="flex-1" />
            {mode === 'demo'
              ? <span className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-300">Demo mode</span>
              : <span className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-red-700 dark:bg-red-950 dark:text-red-300">Live mode</span>}
            <span className="hidden text-sm sm:inline">{user.name}</span>
          </header>
          {killSwitch && (
            <div className="flex items-center gap-2 bg-red-600 px-4 py-2 text-sm font-medium text-white" role="alert">
              <OctagonAlert className="h-4 w-4" /> Emergency kill switch is ON — all dialling is blocked.
              {isAdmin && <Link href="/system" className="ml-auto underline">Manage</Link>}
            </div>
          )}
          {mode === 'demo' && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              Demo mode: calls, transcripts and messages are <strong>simulated</strong> and labelled DEMO. No real person is contacted.
            </div>
          )}
          <main id="content" className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </MeCtx.Provider>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-5 py-4">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white"><PhoneCall className="h-4 w-4" /></span>
      <span className="font-semibold tracking-tight">VMS Smart Calling</span>
    </Link>
  );
}
function UserBox({ user, onLogout }: { user: Me; onLogout: () => void }) {
  return (
    <div className="border-t border-[rgb(var(--border))] p-3">
      <Link href="/account" className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[rgb(var(--surface-2))]">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">{user.name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{user.name}</span><span className="muted block text-xs">{user.role === 'ADMIN' ? 'Administrator' : 'Sales executive'}</span></span>
      </Link>
      <button onClick={onLogout} className="muted mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[rgb(var(--surface-2))]"><LogOut className="h-4 w-4" />Sign out</button>
    </div>
  );
}
