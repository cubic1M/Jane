-- When and why each finding first appeared, and whether Jane told the person at once
-- (src/lib/live/arrivals.ts). Row-level security reaches it by user_id (docs/security/rls.md).
CREATE TABLE "finding_arrivals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "trigger_at" TIMESTAMPTZ(3) NOT NULL,
    "found_at" TIMESTAMPTZ(3) NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "notice" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_arrivals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "finding_arrivals_finding_id_key" ON "finding_arrivals"("finding_id");

CREATE INDEX "finding_arrivals_user_id_notice_created_at_idx" ON "finding_arrivals"("user_id", "notice", "created_at");

CREATE INDEX "finding_arrivals_trigger_created_at_idx" ON "finding_arrivals"("trigger", "created_at");

ALTER TABLE "finding_arrivals" ADD CONSTRAINT "finding_arrivals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "finding_arrivals" ADD CONSTRAINT "finding_arrivals_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
