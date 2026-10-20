-- CreateTable
CREATE TABLE "payroll_changes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "partner_ref" TEXT NOT NULL,
    "from_rate" DOUBLE PRECISION NOT NULL,
    "to_rate" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "effective_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_changes_user_id_created_at_idx" ON "payroll_changes"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "payroll_changes" ADD CONSTRAINT "payroll_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

