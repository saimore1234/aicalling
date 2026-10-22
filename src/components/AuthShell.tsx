import type { ReactNode } from 'react';
import { PhoneCall } from 'lucide-react';

/** Centered card layout for login / setup / reset pages. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white"><PhoneCall className="h-5 w-5" /></span>
          <span className="text-xl font-semibold tracking-tight">VMS Smart Calling</span>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </main>
  );
}
