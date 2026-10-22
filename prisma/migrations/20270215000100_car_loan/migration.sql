-- CreateTable
CREATE TABLE "car_addons" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paid_cents" INTEGER NOT NULL,
    "term_months" INTEGER NOT NULL,
    "started_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'found',
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "car_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "car_loan_watches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "best_apr_bps" INTEGER,
    "band" TEXT,
    "change" TEXT,
    "changed_on" DATE,
    "checked_on" DATE,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "car_loan_watches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "car_addons_user_id_idx" ON "car_addons"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "car_addons_user_id_key_key" ON "car_addons"("user_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "car_loan_watches_user_id_key" ON "car_loan_watches"("user_id");

-- AddForeignKey
ALTER TABLE "car_addons" ADD CONSTRAINT "car_addons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_loan_watches" ADD CONSTRAINT "car_loan_watches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


