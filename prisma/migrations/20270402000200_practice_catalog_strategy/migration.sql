-- A strategy from the catalog the practice portfolio follows instead of the mix (Phase AW, Stage A).
ALTER TABLE "practice_preferences" ADD COLUMN "catalog_strategy" TEXT NOT NULL DEFAULT 'off';
