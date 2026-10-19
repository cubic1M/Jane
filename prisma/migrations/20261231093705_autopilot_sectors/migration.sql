-- CreateTable
CREATE TABLE "autopilot_sectors" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "action_cap_cents" INTEGER NOT NULL,
    "monthly_cap_cents" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "autopilot_sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autopilot_acts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "cents" INTEGER NOT NULL,
    "what" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autopilot_acts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autopilot_sectors_user_id_sector_key" ON "autopilot_sectors"("user_id", "sector");

-- CreateIndex
CREATE INDEX "autopilot_acts_user_id_sector_created_at_idx" ON "autopilot_acts"("user_id", "sector", "created_at");

-- AddForeignKey
ALTER TABLE "autopilot_sectors" ADD CONSTRAINT "autopilot_sectors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopilot_acts" ADD CONSTRAINT "autopilot_acts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

