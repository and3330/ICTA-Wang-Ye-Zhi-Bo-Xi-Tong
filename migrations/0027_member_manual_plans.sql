-- Manual plans deliberately share the existing audited entitlement surface.
-- They are not Stripe subscriptions and never update users.subscription_plan.
ALTER TABLE "entitlement_overrides" ADD COLUMN IF NOT EXISTS "manual_plan" text;
ALTER TABLE "entitlement_overrides" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "entitlement_overrides" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp;
ALTER TABLE "entitlement_overrides" ADD COLUMN IF NOT EXISTS "revoked_by" varchar REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "entitlement_overrides" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entitlement_overrides_manual_plan_check'
  ) THEN
    ALTER TABLE "entitlement_overrides"
      ADD CONSTRAINT "entitlement_overrides_manual_plan_check"
      CHECK ("manual_plan" IS NULL OR "manual_plan" IN ('starter', 'growth', 'scale'));
  END IF;
END $$;

-- Retaining the row after expiry/revocation prevents a subsequent grant from
-- silently erasing its local history; the audit log records each transition.
CREATE UNIQUE INDEX IF NOT EXISTS "entitlement_overrides_one_manual_plan_per_user"
  ON "entitlement_overrides" ("user_id")
  WHERE "manual_plan" IS NOT NULL;