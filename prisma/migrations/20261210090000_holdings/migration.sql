-- CreateTable
CREATE TABLE "securities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plaid_security_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticker" TEXT,
    "type" TEXT,
    "subtype" TEXT,
    "is_cash_equivalent" BOOLEAN NOT NULL DEFAULT false,
    "close_price_cents" INTEGER,
    "close_price_as_of" DATE,
    "sector" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "securities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holdings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "security_id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "price_as_of" DATE,
    "value_cents" INTEGER NOT NULL,
    "cost_basis_cents" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "security_id" TEXT,
    "plaid_investment_transaction_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "fees_cents" INTEGER,
    "type" TEXT NOT NULL,
    "subtype" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "investment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "securities_user_id_idx" ON "securities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "securities_user_id_plaid_security_id_key" ON "securities"("user_id", "plaid_security_id");

-- CreateIndex
CREATE INDEX "holdings_user_id_idx" ON "holdings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "holdings_account_id_security_id_key" ON "holdings"("account_id", "security_id");

-- CreateIndex
CREATE UNIQUE INDEX "investment_transactions_plaid_investment_transaction_id_key" ON "investment_transactions"("plaid_investment_transaction_id");

-- CreateIndex
CREATE INDEX "investment_transactions_user_id_date_idx" ON "investment_transactions"("user_id", "date");

-- CreateIndex
CREATE INDEX "investment_transactions_account_id_idx" ON "investment_transactions"("account_id");

-- AddForeignKey
ALTER TABLE "securities" ADD CONSTRAINT "securities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_security_id_fkey" FOREIGN KEY ("security_id") REFERENCES "securities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_security_id_fkey" FOREIGN KEY ("security_id") REFERENCES "securities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

