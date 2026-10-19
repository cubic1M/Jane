-- CreateTable
CREATE TABLE "refinance_checks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "checked_on" DATE NOT NULL,
    "partner" TEXT NOT NULL,
    "quotes" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refinance_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refinance_checks_user_id_key" ON "refinance_checks"("user_id");

-- AddForeignKey
ALTER TABLE "refinance_checks" ADD CONSTRAINT "refinance_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

