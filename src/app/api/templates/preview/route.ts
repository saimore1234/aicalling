import { z } from 'zod';
import { route } from '@/lib/api';
import { extractVariables, renderTemplate } from '@/server/templates';

const body = z.object({ subject: z.string().max(300).nullish(), bodyText: z.string().max(4000), bodyHtml: z.string().max(100_000).nullish(), sample: z.record(z.string().max(200)).default({}) });

export const POST = route<Record<string, string>, typeof body>({ body }, async ({ body }) => {
  const vars = { name: 'Asha Verma', first_name: 'Asha', company: 'Sample Traders', product: 'Solar panels', company_name: 'Your company', agent_name: 'Your AI assistant', unsubscribe_url: 'https://example.com/unsubscribe/…', ...body.sample };
  return {
    subject: body.subject ? renderTemplate(body.subject, vars) : null,
    text: renderTemplate(body.bodyText, vars),
    html: body.bodyHtml ? renderTemplate(body.bodyHtml, vars, { escapeHtml: true }) : null,
    variables: extractVariables(body.subject, body.bodyText, body.bodyHtml),
    unknownVariables: extractVariables(body.subject, body.bodyText, body.bodyHtml).filter((v) => !(v in vars)),
  };
});
