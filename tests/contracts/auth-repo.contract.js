import { describe, it, expect } from "vitest";

/**
 * AuthRepository contract — shared test suite.
 * Pass a factory that returns { repo, seedUser }.
 * seedUser inserts a test user and returns { username, password }.
 */
export function authRepoContract(createRepo) {
  describe("AuthRepository contract", () => {
    let repo;
    let seedUser;

    beforeEach(async () => {
      const ctx = await createRepo();
      repo = ctx.repo;
      seedUser = ctx.seedUser;
    });

    describe("resolveLoginEmail()", () => {
      it("retorna email para username válido", async () => {
        const { username } = await seedUser({
          username: "teste.resolver",
          password: "123456",
          full_name: "Teste Resolver",
        });
        const email = await repo.resolveLoginEmail(username);
        expect(typeof email).toBe("string");
        expect(email.length).toBeGreaterThan(0);
      });

      it("lança erro para username inexistente", async () => {
        await expect(
          repo.resolveLoginEmail("naoexiste.naoexiste"),
        ).rejects.toMatchObject({ status: 404 });
      });
    });

    describe("superfície da interface", () => {
      it("não expõe verificação de credenciais", () => {
        // A verificação de senha vive no NextAuth (src/auth.js). Expor um
        // `login()` aqui criaria um segundo caminho de credenciais sem rate
        // limiting — foi removido justamente por isso.
        expect(repo.login).toBeUndefined();
      });
    });
  });
}
