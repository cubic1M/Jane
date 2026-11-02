-- Stage 2: which action an act was part of, and a mistake reported on one.
ALTER TABLE "jane_acts" ADD COLUMN "action_id" TEXT;

CREATE TABLE "act_mistakes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "act_id" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "act_mistakes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "act_mistakes_act_id_key" ON "act_mistakes"("act_id");
CREATE INDEX "act_mistakes_user_id_status_idx" ON "act_mistakes"("user_id", "status");

ALTER TABLE "act_mistakes" ADD CONSTRAINT "act_mistakes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "act_mistakes" ADD CONSTRAINT "act_mistakes_act_id_fkey" FOREIGN KEY ("act_id") REFERENCES "jane_acts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
