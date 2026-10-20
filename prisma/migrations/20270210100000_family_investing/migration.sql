-- CreateTable
CREATE TABLE "family_children" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "earned_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "college_plan_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "gift_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gifts" (
    "id" TEXT NOT NULL,
    "gift_link_id" TEXT NOT NULL,
    "giver_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "family_children_user_id_name_key" ON "family_children"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "gift_links_token_key" ON "gift_links"("token");

-- CreateIndex
CREATE INDEX "gift_links_user_id_idx" ON "gift_links"("user_id");

-- CreateIndex
CREATE INDEX "gifts_gift_link_id_idx" ON "gifts"("gift_link_id");

-- AddForeignKey
ALTER TABLE "family_children" ADD CONSTRAINT "family_children_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_links" ADD CONSTRAINT "gift_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_gift_link_id_fkey" FOREIGN KEY ("gift_link_id") REFERENCES "gift_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

