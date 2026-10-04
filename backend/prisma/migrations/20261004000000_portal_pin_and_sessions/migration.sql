-- AlterTable
ALTER TABLE "customers" ADD COLUMN "pin_hash" TEXT;

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "business_id" UUID,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "auth_sessions_subject_id_kind_idx" ON "auth_sessions"("subject_id", "kind");

CREATE TABLE "portal_login_throttles" (
    "id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "failures" INTEGER NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "cooldown_until" TIMESTAMPTZ(3),

    CONSTRAINT "portal_login_throttles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portal_login_throttles_bucket_key" ON "portal_login_throttles"("bucket");
