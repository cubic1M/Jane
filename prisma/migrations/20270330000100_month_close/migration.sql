-- CreateTable
CREATE TABLE "month_closes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "uncertain" TEXT[],
    "figures" JSONB NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "corrected_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "month_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "month_closes_user_id_month_key" ON "month_closes"("user_id", "month");

-- AddForeignKey
ALTER TABLE "month_closes" ADD CONSTRAINT "month_closes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

