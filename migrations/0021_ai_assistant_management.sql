ALTER TABLE "webinar_documents"
  ADD COLUMN "source_type" text DEFAULT 'text' NOT NULL,
  ADD COLUMN "source_url" text,
  ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;

CREATE TABLE "ai_reply_logs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "webinar_id" varchar NOT NULL REFERENCES "webinars"("id") ON DELETE CASCADE,
  "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "session_id" varchar,
  "reservation_id" varchar REFERENCES "ai_credit_reservations"("id") ON DELETE SET NULL,
  "chat_message_id" varchar REFERENCES "chat_messages"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "question" text NOT NULL,
  "answer" text,
  "status" text NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "model" text,
  "duration_ms" integer DEFAULT 0 NOT NULL,
  "points_charged" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "review_status" text DEFAULT 'unreviewed' NOT NULL,
  "corrected_answer" text,
  "review_notes" text,
  "correction_document_id" varchar,
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ai_reply_logs_kind_check" CHECK ("kind" IN ('live', 'test')),
  CONSTRAINT "ai_reply_logs_status_check" CHECK ("status" IN ('answered', 'fallback', 'error', 'no_credits')),
  CONSTRAINT "ai_reply_logs_review_status_check" CHECK ("review_status" IN ('unreviewed', 'incorrect', 'corrected'))
);

CREATE INDEX "ai_reply_logs_webinar_created_idx" ON "ai_reply_logs" ("webinar_id", "created_at");
CREATE INDEX "ai_reply_logs_webinar_review_idx" ON "ai_reply_logs" ("webinar_id", "review_status");
CREATE INDEX "ai_reply_logs_webinar_session_idx" ON "ai_reply_logs" ("webinar_id", "session_id");