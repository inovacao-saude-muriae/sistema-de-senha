import { prisma } from "../prisma-client.js";
import { routeError } from "./utils.js";

/**
 * Data access for authentication-adjacent lookups.
 *
 * Credential verification lives in `src/auth.js` (NextAuth) and is not exposed
 * here — this repository is intentionally read-only so there is no second,
 * rate-limit-free path to validate a password.
 */
export class AuthRepository {
  /**
   * Resolve login username to email
   * @param {string} username
   * @returns {Promise<string>}
   */
  async resolveLoginEmail(username) {
    const user = await prisma.users.findUnique({
      where: { username: username.toLowerCase() },
      select: { email: true },
    });

    if (!user) {
      throw routeError(404, "Usuário não encontrado");
    }

    return user.email;
  }
}
