-- Removes texts (spec step 78, removed at the person's request): the decision source
-- "text", the text_settings and text_messages tables, and any queued text jobs.
--
-- Recreating decision_source without 'text' fails if any row still uses it. Texts were off
-- in production, so no row should, but to be safe any approval made by a text reply is kept
-- and counted as a one-tap link (the same kind of approval: no-risk items only, held an
-- hour, same take-back window) rather than deleted.
UPDATE "decisions" SET "source" = 'link' WHERE "source" = 'text';

-- Jobs that would send a text have no handler anymore and would only fail; drop them.
DELETE FROM "jobs" WHERE "kind" = 'text_send';

-- AlterEnum
BEGIN;
CREATE TYPE "decision_source_new" AS ENUM ('card', 'plan', 'rule', 'auto', 'link');
ALTER TABLE "public"."decisions" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "decisions" ALTER COLUMN "source" TYPE "decision_source_new" USING ("source"::text::"decision_source_new");
ALTER TYPE "decision_source" RENAME TO "decision_source_old";
ALTER TYPE "decision_source_new" RENAME TO "decision_source";
DROP TYPE "public"."decision_source_old";
ALTER TABLE "decisions" ALTER COLUMN "source" SET DEFAULT 'card';
COMMIT;

-- DropForeignKey
ALTER TABLE "text_messages" DROP CONSTRAINT "text_messages_user_id_fkey";

-- DropForeignKey
ALTER TABLE "text_settings" DROP CONSTRAINT "text_settings_user_id_fkey";

-- DropTable
DROP TABLE "text_messages";

-- DropTable
DROP TABLE "text_settings";

