-- The daily report email. An opt-in switch (off for everyone until they turn it on in /settings), and
-- one row a person a local day: the unique (user, day) is the guarantee that a day never gets two
-- reports whatever the cron does. change_keys are the changes Jane noticed that the report listed, so
-- none is listed twice. Both are new, and safe for the code running now, which doesn't read them.
-- Row-level security reaches the new table by user_id (scripts/rls-protect.mjs, docs/security/rls.md).
ALTER TABLE "users" ADD COLUMN "daily_report_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "daily_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "change_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "daily_reports_user_id_idx" ON "daily_reports"("user_id");

CREATE UNIQUE INDEX "daily_reports_user_id_day_key" ON "daily_reports"("user_id", "day");

ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
