import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seed a test user into the users table via Prisma.
 * Password is hashed with bcrypt before insert.
 * @param {object} data
 * @param {string} data.username
 * @param {string} data.password
 * @param {string} data.full_name
 * @param {string} [data.role]
 * @param {string} [data.sector_id]
 * @returns {{ id: string, username: string, password: string }}
 */
export async function seedTestUser(data) {
  const id = data.id || crypto.randomUUID();
  const username = data.username || `test.user.${Date.now()}`;
  const email = `${username}@central-atendimento.local`;
  const rawPassword = data.password || "default123";
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  await prisma.users.create({
    data: {
      id,
      username,
      email,
      password_hash: passwordHash,
      full_name: data.full_name || "Test User",
      role: data.role || "attendant",
      sector_id: data.sector_id || null,
    },
  });

  return { id, username, password: data.password };
}

/**
 * Clean up test users by username.
 * @param {string[]} usernames
 */
export async function cleanupTestUsers(usernames) {
  if (!usernames.length) return;
  await prisma.users.deleteMany({
    where: { username: { in: usernames } },
  });
}

/**
 * Clean up all test users (prefix test.).
 */
export async function cleanupAllTestUsers() {
  await prisma.users.deleteMany({
    where: { username: { startsWith: "test." } },
  });
}

/**
 * Seed a test news item into the news table via Prisma.
 * @param {object} data
 * @param {string} [data.title]
 * @param {string} [data.image]
 * @param {Date} [data.created_at]
 * @returns {{ id: number, title: string }}
 */
export async function seedTestNews(data = {}) {
  const result = await prisma.news.create({
    data: {
      title: data.title || `Test News ${Date.now()}`,
      image_url: data.image || "https://fake.test/news.jpg",
      active: data.active !== undefined ? data.active : true,
      ...(data.created_at ? { created_at: data.created_at } : {}),
    },
    select: { id: true, title: true },
  });

  return { id: Number(result.id), title: result.title };
}

/**
 * Clean up test news items by id.
 * @param {number[]} ids
 */
export async function cleanupTestNews(ids) {
  if (!ids.length) return;
  await prisma.news.deleteMany({
    where: { id: { in: ids.map(BigInt) } },
  });
}

/**
 * Clean up all news records (for tests that need isolated state).
 */
export async function cleanupAllNews() {
  await prisma.news.deleteMany();
}

/**
 * Seed a queue sequence for a sector/type.
 * @param {'farmacia'|'recepcao'} sector
 * @param {'normal'|'preferencial'} type
 * @param {number} currentNumber
 */
export async function seedTestQueueSequence(sector, type, currentNumber) {
  await prisma.queue_sequences.upsert({
    where: {
      sector_id_call_type: {
        sector_id: sector,
        call_type: type,
      },
    },
    update: { current_number: currentNumber, updated_at: new Date() },
    create: { sector_id: sector, call_type: type, current_number: currentNumber },
  });
}

/**
 * Clean up queue test data (calls + sequences).
 */
export async function cleanupQueueTestData() {
  await prisma.queue_calls.deleteMany();
  await prisma.queue_sequences.deleteMany();
}

export { prisma };
