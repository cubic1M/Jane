-- CreateTable
CREATE TABLE "debt_watches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rates" JSONB NOT NULL DEFAULT '{}',
    "changes" JSONB NOT NULL DEFAULT '[]',
    "plan_started_on" DATE,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "debt_watches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "debt_watches_user_id_key" ON "debt_watches"("user_id");

-- AddForeignKey
ALTER TABLE "debt_watches" ADD CONSTRAINT "debt_watches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

