-- CreateTable
CREATE TABLE "student_loan_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agi_cents" INTEGER,
    "family_size" INTEGER NOT NULL DEFAULT 1,
    "dependants" INTEGER NOT NULL DEFAULT 0,
    "borrower" TEXT NOT NULL DEFAULT 'new',
    "public_service" BOOLEAN NOT NULL DEFAULT false,
    "counted_before" INTEGER NOT NULL DEFAULT 0,
    "steps_done" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_loan_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_loan_profiles_user_id_key" ON "student_loan_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "student_loan_profiles" ADD CONSTRAINT "student_loan_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

