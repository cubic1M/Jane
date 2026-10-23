-- CreateTable
CREATE TABLE "rent_reporting" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "opted_in_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rent_reporting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_deposits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "moved_out_on" DATE,
    "returned_on" DATE,
    "returned_cents" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "security_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rent_reporting_user_id_key" ON "rent_reporting"("user_id");

-- CreateIndex
CREATE INDEX "security_deposits_user_id_idx" ON "security_deposits"("user_id");

-- AddForeignKey
ALTER TABLE "rent_reporting" ADD CONSTRAINT "rent_reporting_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
