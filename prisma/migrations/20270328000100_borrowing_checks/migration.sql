-- CreateTable
CREATE TABLE "borrowing_checks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "checked_on" DATE NOT NULL,
    "partner" TEXT NOT NULL,
    "score" INTEGER,
    "score_on" DATE,
    "figures" JSONB NOT NULL DEFAULT '[]',
    "previous" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "borrowing_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "borrowing_checks_user_id_key" ON "borrowing_checks"("user_id");

-- AddForeignKey
ALTER TABLE "borrowing_checks" ADD CONSTRAINT "borrowing_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

