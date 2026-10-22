import { getEmailProvider } from '@/providers';

export function emailConfigured(): boolean {
  return getEmailProvider().status().configured;
}

/** System (non-marketing) email such as password resets. Never used for promotional messages. */
export async function sendSystemEmail(to: string, subject: string, text: string, html?: string) {
  return getEmailProvider().send({ to, subject, text, html });
}
