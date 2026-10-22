-- CreateTable
CREATE TABLE "values_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "excludes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "values_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "values_preferences_user_id_key" ON "values_preferences"("user_id");

-- AddForeignKey
ALTER TABLE "values_preferences" ADD CONSTRAINT "values_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
