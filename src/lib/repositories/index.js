import { AuthRepository } from "./auth-repo.postgres.js";
import { UsersRepository } from "./users-repo.postgres.js";
import { NewsRepository } from "./news-repo.postgres.js";
import { QueueRepository } from "./queue-repo.postgres.js";
import { ReadRepository } from "./read-repo.postgres.js";

const auth = new AuthRepository();
const users = new UsersRepository();
const news = new NewsRepository();
const queue = new QueueRepository();
const read = new ReadRepository();

export { auth, users, news, queue, read };

export function getDataLayer() {
  return { queue, read, auth, users, news };
}

const repositories = { queue, read, auth, users, news };
export default repositories;
