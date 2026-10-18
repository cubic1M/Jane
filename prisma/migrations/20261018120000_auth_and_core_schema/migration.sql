-- CreateEnum
CREATE TYPE "role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "finding_type" AS ENUM ('subscription_review', 'duplicate_subscription', 'price_increase', 'bank_fees', 'idle_cash', 'insurance_reshop', 'card_interest');

-- CreateEnum
CREATE TYPE "finding_status" AS ENUM ('new', 'shown', 'approved', 'declined', 'in_progress', 'done', 'failed');

-- CreateEnum
CREATE TYPE "confidence" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "decision_choice" AS ENUM ('yes', 'no');

-- CreateEnum
CREATE TYPE "action_type" AS ENUM ('cancel_subscription', 'fight_price_increase', 'recover_bank_fees', 'move_idle_cash', 'insurance_reshop', 'card_interest');

-- CreateEnum
CREATE TYPE "action_status" AS ENUM ('queued', 'in_progress', 'waiting_on_user', 'done', 'failed');

-- CreateEnum
CREATE TYPE "membership_intent_kind" AS ENUM ('reserve', 'paid');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('user', 'admin', 'system');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" TIMESTAMPTZ(3),
    "name" TEXT,
    "image" TEXT,
    "role" "role" NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "plaid_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plaid_item_id" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "institution_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "transactions_cursor" TEXT,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plaid_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "plaid_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mask" TEXT,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "current_balance_cents" INTEGER,
    "available_balance_cents" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "plaid_transaction_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "merchant_name" TEXT,
    "pfc_primary" TEXT,
    "pfc_detailed" TEXT,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_streams" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "plaid_stream_id" TEXT NOT NULL,
    "merchant_name" TEXT,
    "frequency" TEXT NOT NULL,
    "last_amount_cents" INTEGER NOT NULL,
    "average_amount_cents" INTEGER NOT NULL,
    "last_date" DATE,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recurring_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "finding_type" NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT,
    "annual_savings_cents" INTEGER,
    "confidence" "confidence" NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "status" "finding_status" NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "choice" "decision_choice" NOT NULL,
    "card_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actions" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "action_type" NOT NULL,
    "status" "action_status" NOT NULL DEFAULT 'queued',
    "assignee" TEXT,
    "notes" TEXT,
    "minutes_spent" INTEGER,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "opened_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_intents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "membership_intent_kind" NOT NULL,
    "stripe_session_id" TEXT,
    "amount_cents" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" "actor_type" NOT NULL,
    "event" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_accounts_provider_provider_account_id_key" ON "auth_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "plaid_items_plaid_item_id_key" ON "plaid_items"("plaid_item_id");

-- CreateIndex
CREATE INDEX "plaid_items_user_id_idx" ON "plaid_items"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_plaid_account_id_key" ON "accounts"("plaid_account_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE INDEX "accounts_item_id_idx" ON "accounts"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_plaid_transaction_id_key" ON "transactions"("plaid_transaction_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_idx" ON "transactions"("user_id");

-- CreateIndex
CREATE INDEX "transactions_account_id_idx" ON "transactions"("account_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_date_idx" ON "transactions"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_streams_plaid_stream_id_key" ON "recurring_streams"("plaid_stream_id");

-- CreateIndex
CREATE INDEX "recurring_streams_user_id_idx" ON "recurring_streams"("user_id");

-- CreateIndex
CREATE INDEX "recurring_streams_account_id_idx" ON "recurring_streams"("account_id");

-- CreateIndex
CREATE INDEX "findings_user_id_idx" ON "findings"("user_id");

-- CreateIndex
CREATE INDEX "findings_user_id_status_idx" ON "findings"("user_id", "status");

-- CreateIndex
CREATE INDEX "decisions_user_id_idx" ON "decisions"("user_id");

-- CreateIndex
CREATE INDEX "decisions_finding_id_idx" ON "decisions"("finding_id");

-- CreateIndex
CREATE UNIQUE INDEX "actions_decision_id_key" ON "actions"("decision_id");

-- CreateIndex
CREATE INDEX "actions_user_id_idx" ON "actions"("user_id");

-- CreateIndex
CREATE INDEX "actions_status_created_at_idx" ON "actions"("status", "created_at");

-- CreateIndex
CREATE INDEX "digests_user_id_idx" ON "digests"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "digests_user_id_week_start_key" ON "digests"("user_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "membership_intents_stripe_session_id_key" ON "membership_intents"("stripe_session_id");

-- CreateIndex
CREATE INDEX "membership_intents_user_id_idx" ON "membership_intents"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_log_event_created_at_idx" ON "audit_log"("event", "created_at");

-- AddForeignKey
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "plaid_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_streams" ADD CONSTRAINT "recurring_streams_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_streams" ADD CONSTRAINT "recurring_streams_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actions" ADD CONSTRAINT "actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actions" ADD CONSTRAINT "actions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digests" ADD CONSTRAINT "digests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_intents" ADD CONSTRAINT "membership_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
