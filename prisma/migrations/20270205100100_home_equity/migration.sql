-- CreateTable
CREATE TABLE "home_equity_facts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "original_value_cents" INTEGER,
    "yearly_tax_cents" INTEGER,
    "yearly_insurance_cents" INTEGER,
    "pmi_letter_sent_on" DATE,
    "escrow_request_sent_on" DATE,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "home_equity_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "home_equity_facts_user_id_key" ON "home_equity_facts"("user_id");

-- AddForeignKey
ALTER TABLE "home_equity_facts" ADD CONSTRAINT "home_equity_facts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

