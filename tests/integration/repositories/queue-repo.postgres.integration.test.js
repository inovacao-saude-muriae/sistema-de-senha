import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma-client.js";
import { queueRepoContract } from "../../contracts/queue-repo.contract.js";

// Check if Postgres is available
const isPostgresReady = Boolean(process.env.DATABASE_URL);
const describeIfPostgres = isPostgresReady ? describe : describe.skip;

/**
 * Clean up queue test data
 */
async function cleanupQueueTestData() {
  await prisma.queue_calls.deleteMany();
  await prisma.queue_sequences.deleteMany();
  // Clear only the marker — `sectors` rows are seeded and referenced by FKs.
  await prisma.sectors.updateMany({ data: { reset_at: null } });
}

describeIfPostgres("QueueRepository — Postgres integration", () => {
  beforeEach(async () => {
    await cleanupQueueTestData();
  });

  afterEach(async () => {
    await cleanupQueueTestData();
  });

  queueRepoContract(async () => {
    const { QueueRepository } = await import(
      "@/lib/repositories/queue-repo.postgres.js"
    );
    return new QueueRepository();
  });
});
