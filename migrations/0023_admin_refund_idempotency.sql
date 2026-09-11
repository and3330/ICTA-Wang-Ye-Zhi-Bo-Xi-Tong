-- Older development installs may already have applied the initial management
-- tables. Evolve them separately rather than relying on replaying that migration.
ALTER TABLE "admin_mutation_idempotency"
  ADD COLUMN IF NOT EXISTS "payload_fingerprint" varchar(128) NOT NULL DEFAULT '';
ALTER TABLE "admin_mutation_idempotency"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'pending';
ALTER TABLE "admin_mutation_idempotency"
  ADD COLUMN IF NOT EXISTS "provider_reference" varchar(255);