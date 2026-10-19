-- CreateTable
CREATE TABLE "tax_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "filing_status" TEXT,
    "children_under_17" INTEGER,
    "other_dependants" INTEGER,
    "state" TEXT,
    "income_kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answered" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_profiles_user_id_key" ON "tax_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

