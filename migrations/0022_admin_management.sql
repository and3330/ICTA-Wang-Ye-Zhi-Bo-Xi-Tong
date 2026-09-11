CREATE TABLE IF NOT EXISTS "member_admin_metadata" (
  "user_id" varchar PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "management_role" text NOT NULL DEFAULT 'member' CHECK ("management_role" IN ('member', 'support', 'billing', 'read_only', 'super_admin')),
  "notes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "tags" text[] NOT NULL DEFAULT '{}'::text[],
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "entitlement_overrides" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "publishing_slots" integer NOT NULL CHECK ("publishing_slots" > 0 AND "publishing_slots" <= 999),
  "starts_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL,
  "reason" text NOT NULL,
  "created_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CHECK ("expires_at" > "starts_at")
);
CREATE INDEX IF NOT EXISTS "entitlement_overrides_user_expiry_idx"
  ON "entitlement_overrides" ("user_id", "expires_at");

CREATE TABLE IF NOT EXISTS "admin_audit_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "target_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "action" varchar(100) NOT NULL,
  "reason" text NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "request_id" varchar(100),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "admin_audit_events_target_created_idx"
  ON "admin_audit_events" ("target_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "admin_audit_events_created_idx"
  ON "admin_audit_events" ("created_at");

CREATE TABLE IF NOT EXISTS "admin_mutation_idempotency" (
  "idempotency_key" varchar(160) PRIMARY KEY,
  "actor_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "action" varchar(100) NOT NULL,
  "target_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "payload_fingerprint" varchar(128) NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "provider_reference" varchar(255),
  "created_at" timestamp NOT NULL DEFAULT now()
);
ALTER TABLE "admin_mutation_idempotency" ADD COLUMN IF NOT EXISTS "payload_fingerprint" varchar(128) NOT NULL DEFAULT '';
ALTER TABLE "admin_mutation_idempotency" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'pending';
ALTER TABLE "admin_mutation_idempotency" ADD COLUMN IF NOT EXISTS "provider_reference" varchar(255);