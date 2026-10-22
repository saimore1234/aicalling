CREATE TYPE "public"."appointment_status" AS ENUM('REQUESTED', 'SCHEDULED', 'COMPLETED', 'CANCELED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('INTERESTED', 'QUALIFIED', 'NOT_INTERESTED', 'CALLBACK_REQUESTED', 'MEETING_REQUESTED', 'WRONG_NUMBER', 'NO_ANSWER', 'BUSY', 'FAILED', 'DO_NOT_CONTACT', 'HUMAN_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('QUEUED', 'INITIATED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."campaign_lead_status" AS ENUM('PENDING', 'QUEUED', 'IN_PROGRESS', 'RETRY_WAIT', 'COMPLETED', 'FAILED', 'SKIPPED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'RUNNING', 'PAUSED', 'STOPPED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('VOICE', 'SMS', 'EMAIL', 'WHATSAPP');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('UNKNOWN', 'GRANTED', 'DENIED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."follow_up_type" AS ENUM('SEND_EMAIL', 'SEND_SMS', 'SEND_WHATSAPP', 'CREATE_APPOINTMENT', 'SCHEDULE_CALLBACK', 'ASSIGN_HUMAN', 'TASK');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('UPLOADED', 'VALIDATING', 'PREVIEW', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('NOT_CONFIGURED', 'CONFIGURED', 'OK', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('OUTBOUND', 'INBOUND');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_type" AS ENUM('EXPORT', 'ERASE');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'SALES_EXECUTIVE');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('CUSTOMER_OPT_OUT', 'DNC_REGISTRY', 'WRONG_NUMBER', 'ADMIN', 'BOUNCE', 'UNSUBSCRIBE', 'PRIVACY_REQUEST');--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"company_name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"voice_provider" text DEFAULT 'openai' NOT NULL,
	"voice_id" text DEFAULT 'alloy' NOT NULL,
	"model" text DEFAULT 'gpt-realtime' NOT NULL,
	"analysis_model" text DEFAULT 'gpt-4.1-mini' NOT NULL,
	"greeting" text NOT NULL,
	"sales_script" text DEFAULT '' NOT NULL,
	"product_knowledge" text DEFAULT '' NOT NULL,
	"faq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pricing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sales_objectives" text DEFAULT '' NOT NULL,
	"qualification_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"objection_handling" text DEFAULT '' NOT NULL,
	"max_call_seconds" integer DEFAULT 300 NOT NULL,
	"escalation_rules" text DEFAULT '' NOT NULL,
	"human_transfer_number" text,
	"callback_policy" text DEFAULT '' NOT NULL,
	"follow_up_instructions" text DEFAULT '' NOT NULL,
	"response_style" text DEFAULT 'Warm, concise and professional.' NOT NULL,
	"permitted_claims" text DEFAULT '' NOT NULL,
	"restricted_actions" text DEFAULT '' NOT NULL,
	"transcript_enabled" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"call_id" uuid,
	"owner_id" uuid,
	"status" "appointment_status" DEFAULT 'REQUESTED' NOT NULL,
	"title" text NOT NULL,
	"requested_window" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"location" text,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_email" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"job_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"related_type" text,
	"related_id" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"campaign_lead_id" uuid,
	"customer_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_call_sid" text,
	"idempotency_key" text NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"status" "call_status" DEFAULT 'QUEUED' NOT NULL,
	"outcome" "call_outcome",
	"from_number" text,
	"to_number" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"cost_amount" numeric(12, 6),
	"cost_currency" text,
	"end_reason" text,
	"error_code" text,
	"error_message" text,
	"summary" text,
	"transcript_saved" boolean DEFAULT false NOT NULL,
	"analyzed_at" timestamp with time zone,
	"is_test" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "campaign_lead_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"last_outcome" "call_outcome",
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"product" text,
	"segment_filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"owner_id" uuid,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"call_windows" jsonb DEFAULT '[{"days":[1,2,3,4,5],"start":"10:00","end":"18:00"}]'::jsonb NOT NULL,
	"fallback_timezone" text,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"min_interval_minutes" integer DEFAULT 240 NOT NULL,
	"max_concurrent" integer DEFAULT 2 NOT NULL,
	"daily_limit" integer DEFAULT 100 NOT NULL,
	"retry_outcomes" jsonb DEFAULT '["NO_ANSWER","BUSY"]'::jsonb NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"test_phone" text,
	"is_demo" boolean DEFAULT true NOT NULL,
	"launch_confirmed_at" timestamp with time zone,
	"launch_confirmed_by_id" uuid,
	"launched_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"status" "consent_status" NOT NULL,
	"source" text,
	"evidence" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "country_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"require_consent_voice" boolean DEFAULT true NOT NULL,
	"require_consent_sms" boolean DEFAULT true NOT NULL,
	"require_consent_whatsapp" boolean DEFAULT true NOT NULL,
	"require_consent_email" boolean DEFAULT true NOT NULL,
	"require_dnd_scrub" boolean DEFAULT false NOT NULL,
	"dnd_scrub_confirmed_at" timestamp with time zone,
	"require_dlt_template" boolean DEFAULT false NOT NULL,
	"call_window_start" text DEFAULT '09:00' NOT NULL,
	"call_window_end" text DEFAULT '20:00' NOT NULL,
	"allowed_weekdays" integer[] DEFAULT ARRAY[1,2,3,4,5,6]::integer[] NOT NULL,
	"default_timezone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"stored_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_type" text NOT NULL,
	"status" "import_status" DEFAULT 'UPLOADED' NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sample_rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"preview" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"phone" text,
	"phone_raw" text,
	"email" text,
	"country" varchar(2),
	"timezone" text,
	"language" text,
	"product_interest" text,
	"category" text,
	"lead_source" text,
	"owner_id" uuid,
	"stage_id" uuid,
	"lead_score" integer,
	"lead_score_reason" text,
	"last_outcome" "call_outcome",
	"last_contacted_at" timestamp with time zone,
	"notes" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"do_not_call" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"import_id" uuid,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_contact_required" CHECK ("customers"."phone" is not null or "customers"."email" is not null)
);
--> statement-breakpoint
CREATE TABLE "follow_up_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"campaign_id" uuid,
	"outcome" "call_outcome" NOT NULL,
	"action" "follow_up_type" NOT NULL,
	"template_id" uuid,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"call_id" uuid,
	"campaign_id" uuid,
	"rule_id" uuid,
	"type" "follow_up_type" NOT NULL,
	"status" "follow_up_status" DEFAULT 'PENDING' NOT NULL,
	"template_id" uuid,
	"title" text,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_message_id" uuid,
	"result_appointment_id" uuid,
	"assigned_to_id" uuid,
	"idempotency_key" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_row_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"kind" text NOT NULL,
	"raw_data" jsonb NOT NULL,
	"errors" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "integration_status" DEFAULT 'NOT_CONFIGURED' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"call_id" uuid,
	"outcome" "call_outcome" NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interest_level" text,
	"next_step" text,
	"callback_at" timestamp with time zone,
	"meeting_preference" text,
	"source" text DEFAULT 'AI' NOT NULL,
	"ai_model" text,
	"raw_output" jsonb,
	"supersedes_id" uuid,
	"created_by_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_qual_score_range" CHECK ("lead_qualifications"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"channel" "channel" NOT NULL,
	"subject" text,
	"body_text" text NOT NULL,
	"body_html" text,
	"language" text DEFAULT 'en' NOT NULL,
	"is_marketing" boolean DEFAULT true NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"provider_template_id" text,
	"dlt_template_id" text,
	"dlt_entity_id" text,
	"attachment_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"direction" "message_direction" DEFAULT 'OUTBOUND' NOT NULL,
	"status" "message_status" DEFAULT 'QUEUED' NOT NULL,
	"template_id" uuid,
	"call_id" uuid,
	"follow_up_task_id" uuid,
	"to_address" text NOT NULL,
	"from_address" text,
	"subject" text,
	"body" text NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"error_code" text,
	"error_message" text,
	"is_marketing" boolean DEFAULT true NOT NULL,
	"idempotency_key" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"is_won" boolean DEFAULT false NOT NULL,
	"is_lost" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"customer_ref" text,
	"type" "privacy_request_type" NOT NULL,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"requested_by_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "channel",
	"phone" text,
	"email" text,
	"customer_id" uuid,
	"reason" "suppression_reason" NOT NULL,
	"source" text,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by_id" uuid,
	CONSTRAINT "suppression_target_required" CHECK ("suppression_records"."phone" is not null or "suppression_records"."email" is not null or "suppression_records"."customer_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"full_text" text DEFAULT '' NOT NULL,
	"language" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'SALES_EXECUTIVE' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_lower" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "webhook_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_key" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_campaign_lead_id_campaign_leads_id_fk" FOREIGN KEY ("campaign_lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_launch_confirmed_by_id_users_id_fk" FOREIGN KEY ("launch_confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_policies" ADD CONSTRAINT "country_policies_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_imports" ADD CONSTRAINT "customer_imports_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_import_id_customer_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."customer_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_rule_id_follow_up_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."follow_up_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_result_appointment_id_appointments_id_fk" FOREIGN KEY ("result_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row_errors" ADD CONSTRAINT "import_row_errors_import_id_customer_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."customer_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_configurations" ADD CONSTRAINT "integration_configurations_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_follow_up_task_id_follow_up_tasks_id_fk" FOREIGN KEY ("follow_up_task_id") REFERENCES "public"."follow_up_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_records" ADD CONSTRAINT "suppression_records_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_records" ADD CONSTRAINT "suppression_records_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_records" ADD CONSTRAINT "suppression_records_lifted_by_id_users_id_fk" FOREIGN KEY ("lifted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_agents_active_idx" ON "ai_agents" USING btree ("active");--> statement-breakpoint
CREATE INDEX "appointments_customer_idx" ON "appointments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "appointments_status_idx" ON "appointments" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_queue_job_unique" ON "background_jobs" USING btree ("queue","job_id");--> statement-breakpoint
CREATE INDEX "background_jobs_status_idx" ON "background_jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "call_events_call_idx" ON "call_events" USING btree ("call_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_idempotency_unique" ON "calls" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_provider_sid_unique" ON "calls" USING btree ("provider_call_sid") WHERE "calls"."provider_call_sid" is not null;--> statement-breakpoint
CREATE INDEX "calls_customer_idx" ON "calls" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "calls_campaign_status_idx" ON "calls" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "calls_status_idx" ON "calls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "calls_created_idx" ON "calls" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_leads_unique" ON "campaign_leads" USING btree ("campaign_id","customer_id");--> statement-breakpoint
CREATE INDEX "campaign_leads_pick_idx" ON "campaign_leads" USING btree ("campaign_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "campaign_leads_customer_idx" ON "campaign_leads" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaigns_agent_idx" ON "campaigns" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "consent_customer_channel_idx" ON "consent_records" USING btree ("customer_id","channel","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "country_policies_code_unique" ON "country_policies" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "customer_imports_created_idx" ON "customer_imports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "customer_notes_customer_idx" ON "customer_notes" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_active_unique" ON "customers" USING btree ("phone") WHERE "customers"."deleted_at" is null and "customers"."phone" is not null;--> statement-breakpoint
CREATE INDEX "customers_owner_idx" ON "customers" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "customers_stage_idx" ON "customers" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "customers_country_idx" ON "customers" USING btree ("country");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customers_demo_idx" ON "customers" USING btree ("is_demo");--> statement-breakpoint
CREATE INDEX "customers_created_idx" ON "customers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "follow_up_rules_outcome_idx" ON "follow_up_rules" USING btree ("outcome","active");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_tasks_idem_unique" ON "follow_up_tasks" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "follow_up_tasks_due_idx" ON "follow_up_tasks" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "follow_up_tasks_customer_idx" ON "follow_up_tasks" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "import_row_errors_import_idx" ON "import_row_errors" USING btree ("import_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_key_unique" ON "integration_configurations" USING btree ("key");--> statement-breakpoint
CREATE INDEX "lead_qual_customer_idx" ON "lead_qualifications" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_qual_call_idx" ON "lead_qualifications" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "message_templates_channel_idx" ON "message_templates" USING btree ("channel");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_idem_unique" ON "messages" USING btree ("idempotency_key") WHERE "messages"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "messages_customer_idx" ON "messages" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_provider_id_idx" ON "messages" USING btree ("provider","provider_message_id");--> statement-breakpoint
CREATE INDEX "messages_status_idx" ON "messages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "prt_token_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "prt_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_key_unique" ON "pipeline_stages" USING btree ("key");--> statement-breakpoint
CREATE INDEX "privacy_requests_created_idx" ON "privacy_requests" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "suppression_phone_idx" ON "suppression_records" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "suppression_email_idx" ON "suppression_records" USING btree ("email");--> statement-breakpoint
CREATE INDEX "suppression_customer_idx" ON "suppression_records" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcripts_call_unique" ON "transcripts" USING btree ("call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_receipts_unique" ON "webhook_receipts" USING btree ("provider","event_key");