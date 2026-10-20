-- CreateTable
CREATE TABLE "lean_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "change_key" TEXT NOT NULL,
    "employer" TEXT NOT NULL,
    "due_on" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "lean_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lean_plans_user_id_change_key_key" ON "lean_plans"("user_id", "change_key");

-- AddForeignKey
ALTER TABLE "lean_plans" ADD CONSTRAINT "lean_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

