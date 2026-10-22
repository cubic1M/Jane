-- CreateTable
CREATE TABLE "plan_menus" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "funds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_changes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "menu_id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "partner_ref" TEXT NOT NULL,
    "allocation" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_menus_user_id_idx" ON "plan_menus"("user_id");

-- CreateIndex
CREATE INDEX "plan_changes_user_id_idx" ON "plan_changes"("user_id");

-- AddForeignKey
ALTER TABLE "plan_menus" ADD CONSTRAINT "plan_menus_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

