-- Additive registration flow. Does not rewrite users, passwords, roles or business data.
-- A row here is not an account. users are inserted only when an admin approves.

CREATE TYPE "RegistrationStatus" AS ENUM (
  'PENDING_EMAIL_VERIFICATION',
  'PENDING_ADMIN_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXPIRED'
);

CREATE TABLE "registration_requests" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "status" "RegistrationStatus" NOT NULL,
  "email_token_hash" TEXT,
  "email_token_expires_at" TIMESTAMPTZ(3),
  "email_verified_at" TIMESTAMPTZ(3),
  "token_generation" INTEGER NOT NULL DEFAULT 0,
  "resend_count" INTEGER NOT NULL DEFAULT 0,
  "last_resend_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "decided_at" TIMESTAMPTZ(3),
  "decided_by_user_id" UUID,
  "decision_note" TEXT,
  "user_id" UUID,
  "business_id" UUID,
  "admin_notified_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "registration_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registration_requests_email_key" ON "registration_requests"("email");
CREATE UNIQUE INDEX "registration_requests_email_token_hash_key" ON "registration_requests"("email_token_hash");
CREATE UNIQUE INDEX "registration_requests_user_id_key" ON "registration_requests"("user_id");
CREATE INDEX "registration_requests_status_created_at_idx" ON "registration_requests"("status", "created_at");

ALTER TABLE "registration_requests"
  ADD CONSTRAINT "registration_requests_decided_by_user_id_fkey"
  FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "registration_requests"
  ADD CONSTRAINT "registration_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "registration_requests"
  ADD CONSTRAINT "registration_requests_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "registration_decision_logs" (
  "id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_decision_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "registration_decision_logs_request_id_created_at_idx"
  ON "registration_decision_logs"("request_id", "created_at");

ALTER TABLE "registration_decision_logs"
  ADD CONSTRAINT "registration_decision_logs_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "registration_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "registration_decision_logs"
  ADD CONSTRAINT "registration_decision_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "email_outbox" (
  "id" UUID NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "to_address" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "text_body" TEXT NOT NULL,
  "html_body" TEXT NOT NULL,
  "sent_at" TIMESTAMPTZ(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_outbox_dedupe_key_key" ON "email_outbox"("dedupe_key");
CREATE INDEX "email_outbox_sent_at_attempts_idx" ON "email_outbox"("sent_at", "attempts");
