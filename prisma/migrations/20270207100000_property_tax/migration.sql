-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "home_market_cents" INTEGER,
ADD COLUMN     "home_assessed_cents" INTEGER,
ADD COLUMN     "home_assessed_year" INTEGER,
ADD COLUMN     "home_notice_on" DATE,
ADD COLUMN     "owner_age" INTEGER,
ADD COLUMN     "owner_veteran" BOOLEAN,
ADD COLUMN     "owner_disabled" BOOLEAN,
ADD COLUMN     "exemptions_claimed" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "property_appeals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "assessed_cents" INTEGER NOT NULL,
    "market_cents" INTEGER NOT NULL,
    "saving_cents" INTEGER NOT NULL,
    "board" TEXT NOT NULL,
    "comps" JSONB NOT NULL,
    "draft" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'drafted',
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_appeals_user_id_year_key" ON "property_appeals"("user_id", "year");

-- AddForeignKey
ALTER TABLE "property_appeals" ADD CONSTRAINT "property_appeals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
