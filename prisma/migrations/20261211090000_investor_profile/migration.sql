-- CreateTable
CREATE TABLE "investor_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "age" INTEGER,
    "age_on" DATE,
    "horizon" TEXT,
    "drop_reaction" TEXT,
    "goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "investor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investor_profiles_user_id_key" ON "investor_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "investor_profiles" ADD CONSTRAINT "investor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

