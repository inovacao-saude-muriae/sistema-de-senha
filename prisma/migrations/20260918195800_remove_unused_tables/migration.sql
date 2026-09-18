/*
  Warnings:

  - You are about to drop the `queue_counters` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `queues` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `settings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "queue_counters" DROP CONSTRAINT "queue_counters_sector_id_fkey";

-- DropForeignKey
ALTER TABLE "queues" DROP CONSTRAINT "queues_sector_id_fkey";

-- DropForeignKey
ALTER TABLE "settings" DROP CONSTRAINT "settings_user_id_fkey";

-- DropTable
DROP TABLE "queue_counters";

-- DropTable
DROP TABLE "queues";

-- DropTable
DROP TABLE "settings";
