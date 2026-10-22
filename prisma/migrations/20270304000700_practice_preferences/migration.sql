-- CreateTable
CREATE TABLE "practice_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "risk_level" INTEGER,
    "max_drop_percent" INTEGER,
    "goal" TEXT,
    "goal_date" DATE,
    "monthly_add_cents" INTEGER NOT NULL,
    "add_day" INTEGER NOT NULL,
    "appetite" TEXT NOT NULL,
    "avoid" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "harvest_losses" BOOLEAN NOT NULL,
    "cash_buffer_cents" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "practice_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_preferences_user_id_key" ON "practice_preferences"("user_id");

-- AddForeignKey
ALTER TABLE "practice_preferences" ADD CONSTRAINT "practice_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

