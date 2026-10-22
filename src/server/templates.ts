/** Placeholder rendering for message templates: {{variable}}. Unknown variables render as empty strings. */
export function renderTemplate(source: string, vars: Record<string, string>, opts: { escapeHtml?: boolean } = {}): string {
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key] ?? '';
    return opts.escapeHtml ? escapeHtml(v) : v;
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function extractVariables(...sources: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const s of sources) {
    if (!s) continue;
    for (const m of s.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) found.add(m[1]!);
  }
  return [...found];
}

export const KNOWN_VARIABLES = ['name', 'first_name', 'company', 'product', 'agent_name', 'company_name', 'unsubscribe_url'] as const;
