-- The household fact record for the tax engine (tax roadmap 1.3, step T9): two new tables. tax_facts
-- holds one tax fact per row (a key such as "filing.status", for a tax year and a member of the
-- household, with its origin, confidence and the person's own day it was true); an older answer is
-- kept with superseded_at set, never overwritten. tax_household_members holds the children and
-- other relatives a tax year counts. Additive: two new tables and nothing else, no change to any
-- existing table, no backfill (a later release fills them from the old stores when a person's
-- household is first read). Safe for the code running now, which does not read or write them. Both
-- have user_id and are deleted with their user; row-level security reaches them by user_id
-- (scripts/rls-protect.mjs, docs/security/rls.md). The partial unique index is the one thing Prisma
-- cannot express, so it lives here and in a comment on the model: a fact has at most one current
-- row per origin, which is what lets a newer answer supersede an older one without a race adding
-- two.
CREATE TABLE "tax_facts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tax_year" INTEGER NOT NULL,
    "member_key" TEXT NOT NULL DEFAULT 'self',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "source_ref" TEXT,
    "confidence" INTEGER NOT NULL,
    "as_of" DATE NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(3),

    CONSTRAINT "tax_facts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_facts_status_check" CHECK ("status" IN ('known', 'inferred')),
    CONSTRAINT "tax_facts_origin_check" CHECK ("origin" IN ('answer', 'document', 'connector', 'transaction', 'legacy')),
    CONSTRAINT "tax_facts_confidence_check" CHECK ("confidence" BETWEEN 0 AND 100)
);

CREATE TABLE "tax_household_members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tax_year" INTEGER NOT NULL,
    "member_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "tax_household_members_pkey" PRIMARY KEY ("id")
);

-- The read path, loadTaxHousehold(userId, year): a person's facts for a year, then by key.
CREATE INDEX "tax_facts_user_id_tax_year_key_idx" ON "tax_facts"("user_id", "tax_year", "key");

-- One current row per fact, year, member and origin.
CREATE UNIQUE INDEX "tax_facts_current_key" ON "tax_facts"("user_id", "tax_year", "member_key", "key", "origin") WHERE "superseded_at" IS NULL;

CREATE UNIQUE INDEX "tax_household_members_user_id_tax_year_member_key_key" ON "tax_household_members"("user_id", "tax_year", "member_key");

ALTER TABLE "tax_facts" ADD CONSTRAINT "tax_facts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tax_household_members" ADD CONSTRAINT "tax_household_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
