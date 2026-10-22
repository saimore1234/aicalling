export type ProviderStatus = {
  configured: boolean;
  /** Names of environment variables that are still missing. Values are never exposed. */
  missing: string[];
  detail?: string;
};

export class ProviderNotConfiguredError extends Error {
  constructor(
    public provider: string,
    public missing: string[],
  ) {
    super(`${provider} is not configured (missing: ${missing.join(', ')})`);
    this.name = 'ProviderNotConfiguredError';
  }
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public opts: { retryable?: boolean; code?: string; status?: number } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
  }
  get retryable() {
    return this.opts.retryable ?? false;
  }
}

/* ----------------------------- Email ----------------------------- */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; url: string }[];
};
export interface EmailProvider {
  readonly name: string;
  /** True when the provider reports delivery events (webhooks). SMTP cannot, so it never reports DELIVERED. */
  readonly supportsDeliveryStatus: boolean;
  status(): ProviderStatus;
  send(msg: EmailMessage): Promise<{ providerMessageId: string | null }>;
}

/* ------------------------------ SMS ------------------------------ */
export type SmsMessage = { to: string; body: string; statusCallbackUrl?: string; contentSid?: string };
export interface SmsProvider {
  readonly name: string;
  status(): ProviderStatus;
  send(msg: SmsMessage): Promise<{ providerMessageId: string }>;
}

/* ---------------------------- WhatsApp --------------------------- */
export type WhatsAppTemplateMessage = { to: string; templateName: string; language: string; variables: string[] };
export interface WhatsAppProvider {
  readonly name: string;
  status(): ProviderStatus;
  sendTemplate(msg: WhatsAppTemplateMessage): Promise<{ providerMessageId: string }>;
}

/* --------------------------- Telephony --------------------------- */
export type PlaceCallRequest = {
  callId: string;
  to: string;
  from?: string;
  voiceUrl: string; // returns TwiML / call-control instructions
  statusCallbackUrl: string;
  ringTimeoutSeconds: number;
  maxDurationSeconds: number;
};
export type ProviderCallInfo = {
  status: string;
  durationSeconds?: number;
  price?: number;
  priceUnit?: string;
  startTime?: Date;
  endTime?: Date;
};
export interface TelephonyProvider {
  readonly name: string;
  status(): ProviderStatus;
  placeCall(req: PlaceCallRequest): Promise<{ providerCallId: string; initialStatus: string }>;
  hangup(providerCallId: string): Promise<void>;
  fetchCall(providerCallId: string): Promise<ProviderCallInfo | null>;
  /** Redirect the live call to new instructions, e.g. a human transfer. */
  redirect?(providerCallId: string, instructionsXml: string): Promise<void>;
}

/* --------------------------- AI analysis ------------------------- */
export type AnalysisInput = {
  model: string;
  transcript: string;
  language: string;
  customerName: string;
  company: string | null;
  nowIso: string;
  customerTimezone: string | null;
  productContext: string;
  qualificationQuestions: string[];
};
export interface AnalysisProvider {
  readonly name: string;
  status(): ProviderStatus;
  /** Returns RAW structured output. The caller validates it against a Zod schema and never trusts it blindly. */
  analyzeCall(input: AnalysisInput): Promise<{ output: unknown; model: string }>;
}
