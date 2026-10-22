import { getEnv } from '@/lib/env';
import { ProviderError, ProviderNotConfiguredError, type ProviderStatus, type WhatsAppProvider, type WhatsAppTemplateMessage } from './types';

/** WhatsApp Business Platform (Meta Cloud API). Business-initiated messages are template-only. */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta-cloud';

  status(): ProviderStatus {
    const env = getEnv();
    const missing = [
      !env.WHATSAPP_ACCESS_TOKEN && 'WHATSAPP_ACCESS_TOKEN',
      !env.WHATSAPP_PHONE_NUMBER_ID && 'WHATSAPP_PHONE_NUMBER_ID',
    ].filter(Boolean) as string[];
    return { configured: missing.length === 0, missing };
  }

  async sendTemplate(msg: WhatsAppTemplateMessage) {
    const st = this.status();
    if (!st.configured) throw new ProviderNotConfiguredError(this.name, st.missing);
    const env = getEnv();
    const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: msg.to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: msg.templateName,
        language: { code: msg.language },
        components: msg.variables.length
          ? [{ type: 'body', parameters: msg.variables.map((v) => ({ type: 'text', text: v })) }]
          : [],
      },
    };
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new ProviderError(this.name, `WhatsApp request failed: ${(err as Error).message}`, { retryable: true });
    }
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok || !json.messages?.[0]?.id) {
      throw new ProviderError(this.name, `WhatsApp rejected the message (${res.status}): ${json.error?.message ?? 'unknown error'}`, {
        retryable: res.status >= 500 || res.status === 429,
        status: res.status,
        code: json.error?.code ? String(json.error.code) : undefined,
      });
    }
    return { providerMessageId: json.messages[0].id };
  }
}
