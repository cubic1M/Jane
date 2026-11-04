-- How landing-page tries went, as daily totals, and what people said during one. Neither holds an
-- id or is tied to a person, so both stay after a try is deleted.
CREATE TABLE "try_stats" (
    "day" DATE NOT NULL,
    "event" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "try_stats_pkey" PRIMARY KEY ("day","event")
);

CREATE TABLE "try_feedback" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "try_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "try_feedback_created_at_idx" ON "try_feedback"("created_at");
