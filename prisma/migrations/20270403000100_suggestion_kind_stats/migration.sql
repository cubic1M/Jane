-- CreateTable
CREATE TABLE "suggestion_kind_stats" (
    "topic" TEXT NOT NULL,
    "shown" INTEGER NOT NULL DEFAULT 0,
    "acted" INTEGER NOT NULL DEFAULT 0,
    "declined" INTEGER NOT NULL DEFAULT 0,
    "decided" INTEGER NOT NULL DEFAULT 0,
    "paid_off" INTEGER NOT NULL DEFAULT 0,
    "confirmed_cents" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suggestion_kind_stats_pkey" PRIMARY KEY ("topic")
);

