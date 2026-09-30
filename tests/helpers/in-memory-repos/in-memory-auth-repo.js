import crypto from "node:crypto";

/**
 * In-memory implementation of AuthRepository for fast contract testing.
 * Uses a simple Map to simulate user storage.
 */
export class InMemoryAuthRepository {
  #users = new Map(); // username → { id, email, password, full_name, role, sector_id, active }

  /**
   * Seed a user into the in-memory store.
   * @param {object} data
   * @returns {{ username: string, password: string }}
   */
  seedUser(data) {
    const id = crypto.randomUUID();
    const username = data.username.toLowerCase();
    const email = `${username}@central-atendimento.local`;
    this.#users.set(username, {
      id,
      email,
      password: data.password,
      full_name: data.full_name,
      role: data.role || "attendant",
      sector_id: data.sector_id || null,
      active: true,
    });
    return { username, password: data.password };
  }

  async resolveLoginEmail(username) {
    const user = this.#users.get(username.toLowerCase());
    if (!user) {
      const err = new Error("Usuário não encontrado");
      err.status = 404;
      throw err;
    }
    return user.email;
  }
}
