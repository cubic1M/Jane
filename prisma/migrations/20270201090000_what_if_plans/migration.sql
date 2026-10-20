-- CreateTable
CREATE TABLE "what_if_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'adopted',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "what_if_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "what_if_plans_user_id_status_idx" ON "what_if_plans"("user_id", "status");

-- AddForeignKey
ALTER TABLE "what_if_plans" ADD CONSTRAINT "what_if_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

