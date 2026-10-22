-- The short forms of a suggestion: a headline and one "why you" line.
ALTER TABLE "suggestions" ADD COLUMN "headline" TEXT NOT NULL DEFAULT '';
ALTER TABLE "suggestions" ADD COLUMN "short" TEXT NOT NULL DEFAULT '';
