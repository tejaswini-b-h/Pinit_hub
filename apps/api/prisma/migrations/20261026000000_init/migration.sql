-- CreateEnum
CREATE TYPE "TargetStatus" AS ENUM ('SCHEDULED', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'RETRYING', 'NEEDS_RECONNECT', 'FAILED', 'BLOCKED', 'CANCELLED');

CREATE TABLE "social_accounts" (
  "id" UUID NOT NULL, "owner_id" TEXT NOT NULL, "platform" TEXT NOT NULL, "external_id" TEXT NOT NULL,
  "display_name" TEXT NOT NULL, "access_token_enc" TEXT NOT NULL, "refresh_token_enc" TEXT,
  "expires_at" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "social_accounts_owner_id_platform_external_id_key" ON "social_accounts"("owner_id", "platform", "external_id");

CREATE TABLE "posts" (
  "id" UUID NOT NULL, "owner_id" TEXT NOT NULL, "body" TEXT NOT NULL, "asset_id" TEXT,
  "scheduled_at" TIMESTAMP(3), "timezone" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotency_key" TEXT, CONSTRAINT "posts_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "posts_owner_id_idempotency_key_key" ON "posts"("owner_id", "idempotency_key");

CREATE TABLE "post_media" (
  "id" UUID NOT NULL, "post_id" UUID NOT NULL, "storage_path" TEXT NOT NULL, "mime" TEXT NOT NULL,
  "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "bytes" INTEGER NOT NULL,
  CONSTRAINT "post_media_pkey" PRIMARY KEY ("id"));

CREATE TABLE "post_targets" (
  "id" UUID NOT NULL, "post_id" UUID NOT NULL, "account_id" UUID NOT NULL, "body_override" TEXT,
  "idempotency_key" TEXT NOT NULL, "status" "TargetStatus" NOT NULL DEFAULT 'QUEUED',
  "attempt_count" INTEGER NOT NULL DEFAULT 0, "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_by" TEXT, "locked_at" TIMESTAMP(3), "external_id" TEXT, "external_url" TEXT,
  "last_error_class" TEXT, "last_error" TEXT, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_targets_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "post_targets_idempotency_key_key" ON "post_targets"("idempotency_key");
CREATE INDEX "post_targets_status_next_attempt_at_idx" ON "post_targets"("status", "next_attempt_at");

CREATE TABLE "publish_attempts" (
  "id" UUID NOT NULL, "target_id" UUID NOT NULL, "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3), "http_status" INTEGER, "error_class" TEXT, "error_code" TEXT, "reason" TEXT,
  CONSTRAINT "publish_attempts_pkey" PRIMARY KEY ("id"));

CREATE TABLE "rate_buckets" (
  "account_id" UUID NOT NULL, "platform" TEXT NOT NULL, "tokens" DOUBLE PRECISION NOT NULL, "refilled_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rate_buckets_pkey" PRIMARY KEY ("account_id", "platform"));

CREATE TABLE "asset_publish_events" (
  "id" UUID NOT NULL, "asset_id" TEXT NOT NULL, "target_id" UUID NOT NULL, "platform" TEXT NOT NULL, "url" TEXT NOT NULL,
  "published_at" TIMESTAMP(3) NOT NULL, "delivered_at" TIMESTAMP(3),
  CONSTRAINT "asset_publish_events_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "asset_publish_events_target_id_key" ON "asset_publish_events"("target_id");

CREATE TABLE "oauth_states" (
  "state" TEXT NOT NULL, "owner_id" TEXT NOT NULL, "platform" TEXT NOT NULL, "code_verifier" TEXT NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("state"));

CREATE TABLE "audit_log" (
  "id" UUID NOT NULL, "owner_id" TEXT NOT NULL, "action" TEXT NOT NULL, "detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id"));

ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "social_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "post_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
