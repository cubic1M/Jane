-- One record of what Jane did, and the stop-all switch (src/lib/permission/).
ALTER TABLE "users" ADD COLUMN "acts_stopped_at" TIMESTAMPTZ(3);

CREATE TABLE "jane_acts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "specialist" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "cents" INTEGER NOT NULL DEFAULT 0,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "authority" TEXT NOT NULL,
    "undo_until" TIMESTAMPTZ(3),
    "undo_href" TEXT,
    "status" TEXT NOT NULL DEFAULT 'started',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jane_acts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "jane_acts_user_id_created_at_idx" ON "jane_acts"("user_id", "created_at");

ALTER TABLE "jane_acts" ADD CONSTRAINT "jane_acts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
