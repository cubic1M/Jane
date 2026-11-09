-- AlterTable
ALTER TABLE "connector_credentials" ADD COLUMN     "link_ref" TEXT,
ADD COLUMN     "refreshed_at" TIMESTAMPTZ(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE UNIQUE INDEX "connector_credentials_connector_id_link_ref_key" ON "connector_credentials"("connector_id", "link_ref");
