import bcrypt from "bcryptjs";
import { prisma } from "../prisma-client.js";
import { isValidUsername, routeError, generateEmail } from "./utils.js";
import { DEFAULT_ROLE, BCRYPT_SALT_ROUNDS } from "../constants.js";

export class UsersRepository {
  /**
   * List all users
   * @returns {Promise<Array<{
   *   id: string,
   *   username?: string,
   *   full_name: string,
   *   role: 'admin'|'attendant',
   *   sector_id: 'farmacia'|'recepcao'|null
   * }>>}
   */
  async list() {
    const users = await prisma.users.findMany({
      select: {
        id: true,
        username: true,
        full_name: true,
        role: true,
        sector_id: true,
      },
      orderBy: { created_at: "desc" },
    });

    return users;
  }

  /**
   * Create a new user
   * @param {{
   *   username: string,
   *   password: string,
   *   full_name: string,
   *   role?: 'admin'|'attendant',
   *   sector_id?: 'farmacia'|'recepcao'|null
   * }} data
   * @returns {Promise<{
   *   success: boolean,
   *   user: {
   *     id: string,
   *     username: string,
   *     full_name: string,
   *     role: 'admin'|'attendant',
   *     sector_id: 'farmacia'|'recepcao'|null
   *   }
   * }>}
   */
  async create(data) {
    const { username: rawUsername, password, full_name, role, sector_id } = data;
    const username = String(rawUsername || "").trim().toLowerCase();

    if (!isValidUsername(username) || !password || !full_name) {
      throw routeError(
        400,
        "Usuário (nome.sobrenome), senha e nome completo são obrigatórios",
      );
    }

    const email = generateEmail(username);
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    try {
      const user = await prisma.users.create({
        data: {
          username,
          email,
          password_hash: passwordHash,
          full_name,
          role: role || DEFAULT_ROLE,
          sector_id: sector_id || null,
        },
        select: {
          id: true,
          username: true,
          full_name: true,
          role: true,
          sector_id: true,
        },
      });

      return { success: true, user };
    } catch (err) {
      if (err.code === "P2002") {
        throw routeError(409, "Nome de usuário já existe");
      }
      throw routeError(err.status || 500, err.message || "Erro ao criar usuário");
    }
  }

  /**
   * Delete a user by id
   * @param {string} id
   * @returns {Promise<void>}
   */
  async remove(id) {
    try {
      await prisma.users.delete({ where: { id } });
    } catch (err) {
      if (err.code === "P2025") {
        throw routeError(404, "Usuário não encontrado");
      }
      throw routeError(err.status || 500, err.message || "Erro ao excluir usuário");
    }
  }
}
