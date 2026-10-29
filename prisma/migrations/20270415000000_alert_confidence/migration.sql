-- Every alert says how sure Jane is (founder: a confidence % on each), as the dock's heads-ups
-- do. Alerts raised before this have none, and show none.
ALTER TABLE "alerts" ADD COLUMN "confidence_percent" INTEGER;
ALTER TABLE "alerts" ADD COLUMN "confidence_reason" TEXT;
