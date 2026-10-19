-- CreateTable
CREATE TABLE "college_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "child_name" TEXT NOT NULL,
    "child_age" INTEGER NOT NULL,
    "age_on" DATE NOT NULL,
    "college_type" TEXT NOT NULL,
    "plan_key" TEXT,
    "goal_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "college_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "college_plans_user_id_idx" ON "college_plans"("user_id");

-- AddForeignKey
ALTER TABLE "college_plans" ADD CONSTRAINT "college_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

