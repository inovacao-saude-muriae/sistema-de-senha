-- AlterTable
ALTER TABLE "news" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "news_active_created_at_id_idx" ON "news"("active", "created_at", "id");
