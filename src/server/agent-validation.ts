import type { aiAgents } from '@/db/schema';

export type AgentRow = typeof aiAgents.$inferSelect;
export type AgentProblem = { field: string; message: string; severity: 'error' | 'warning' };

const AI_DISCLOSURE = /\b(a\.?i\.?|artificial intelligence|virtual assistant|automated assistant|digital assistant|ai assistant|ai voice)\b/i;
const PLACEHOLDER_COMPANY = /^(your company|company name|acme|example|test|n\/a|tbd|xxx*)$/i;

/** Pre-launch validation. Any `error` blocks starting a campaign. */
export function validateAgent(a: Pick<AgentRow, 'active' | 'deletedAt' | 'name' | 'companyName' | 'language' | 'voiceId' | 'model' | 'greeting' | 'productKnowledge' | 'salesObjectives' | 'escalationRules' | 'maxCallSeconds' | 'faq' | 'pricing' | 'humanTransferNumber'>): AgentProblem[] {
  const out: AgentProblem[] = [];
  const err = (field: string, message: string) => out.push({ field, message, severity: 'error' });
  const warn = (field: string, message: string) => out.push({ field, message, severity: 'warning' });

  if (a.deletedAt) err('agent', 'This agent has been deleted.');
  if (!a.active) err('active', 'The agent is inactive.');
  if (!a.name.trim()) err('name', 'Agent name is required.');
  if (!a.companyName.trim() || PLACEHOLDER_COMPANY.test(a.companyName.trim())) err('companyName', 'Enter the real company name the agent calls on behalf of.');
  if (!a.language.trim()) err('language', 'Select the language the agent speaks.');
  if (!a.voiceId.trim()) err('voiceId', 'Select a voice.');
  if (!a.model.trim()) err('model', 'Select a real-time model.');
  if (a.greeting.trim().length < 20) err('greeting', 'The greeting is too short.');
  if (!AI_DISCLOSURE.test(a.greeting)) {
    err('greeting', 'The greeting must clearly identify the caller as an AI assistant (e.g. "I\'m the AI assistant from …"). Callers must never be led to believe they are speaking to a human.');
  }
  if (AI_DISCLOSURE.test(a.greeting) && !/\{\{\s*company(_name)?\s*\}\}/i.test(a.greeting) && !a.greeting.toLowerCase().includes(a.companyName.toLowerCase().slice(0, 4))) {
    warn('greeting', 'The greeting does not mention the company name.');
  }
  if (a.productKnowledge.trim().length < 40) err('productKnowledge', 'Add approved product knowledge. The agent may only discuss information provided here.');
  if (!a.salesObjectives.trim()) err('salesObjectives', 'Describe the objective of the call.');
  if (!a.escalationRules.trim() && !a.humanTransferNumber) err('escalationRules', 'Define when the agent hands over to a human, so unknown questions are escalated rather than answered by guessing.');
  if (a.maxCallSeconds < 30 || a.maxCallSeconds > 1800) err('maxCallSeconds', 'Maximum call duration must be between 30 and 1800 seconds.');
  if (!a.pricing.length) warn('pricing', 'No approved pricing is set, so the agent will say it has no pricing information and offer a human follow-up.');
  if (!a.faq.length) warn('faq', 'No FAQs are set.');
  return out;
}

export const agentIsLaunchable = (problems: AgentProblem[]) => !problems.some((p) => p.severity === 'error');

export const STARTER_AGENT = {
  name: 'Sales assistant',
  companyName: '',
  language: 'en',
  voiceProvider: 'openai',
  voiceId: 'alloy',
  model: 'gpt-realtime',
  greeting:
    "Hello, I'm an AI sales assistant calling on behalf of {{company}}. This call may be transcribed. Is this a convenient time for a brief conversation?",
  salesScript:
    '1. Greet and disclose you are an AI assistant. 2. Ask if it is a good time. 3. Briefly explain why you are calling. 4. Ask 1-2 qualification questions. 5. If interested, offer a short demonstration with the sales team. 6. Thank them and end the call.',
  productKnowledge: '',
  faq: [] as { question: string; answer: string }[],
  pricing: [] as { item: string; price: string; currency?: string; note?: string }[],
  salesObjectives: 'Find out whether the customer is interested in a short demonstration with our sales team.',
  qualificationQuestions: ['What system do you currently use for this?', 'How many people would use it?'],
  objectionHandling: "If the customer says they are busy, offer to call back at a better time. If they are not interested, thank them politely and end the call. Never argue or pressure.",
  maxCallSeconds: 300,
  escalationRules: 'Hand over to a human sales executive if the customer asks for a person, asks something not covered by the approved information, or wants a quote or contract terms.',
  callbackPolicy: 'Offer a callback if the customer is busy. Ask for a day and time and confirm it back.',
  followUpInstructions: 'If the customer is interested, tell them we will email product information and a sales executive will contact them.',
  responseStyle: 'Warm, concise and professional. One or two short sentences per turn.',
  permittedClaims: 'Only statements contained in the approved product knowledge, FAQs and pricing.',
  restrictedActions: 'Do not take payments, collect passwords or card numbers, promise discounts, delivery dates, warranties or features that are not listed, or give legal/financial advice.',
};
