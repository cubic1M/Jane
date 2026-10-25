-- Closed beta: invite codes locked to one email, who made them, revoking; and a waitlist.
ALTER TABLE "invite_codes" ADD COLUMN "email" TEXT,
ADD COLUMN "created_by_id" TEXT,
ADD COLUMN "revoked_at" TIMESTAMPTZ(3);

CREATE TABLE "waitlist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "waitlist_email_key" ON "waitlist"("email");
