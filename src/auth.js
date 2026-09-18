import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { USERNAME_REGEX, DEFAULT_GUICHE } from "./lib/constants.js";
import { initials } from "./lib/repositories/utils.js";

const prisma = new PrismaClient();

export const { handlers, auth, signIn, signOut } = NextAuth({
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Usuário", type: "text" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const username = String(credentials?.username || "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password || "");

        if (!USERNAME_REGEX.test(username) || !password) return null;

        const user = await prisma.users.findUnique({
          where: { username },
        });

        if (!user || !user.active) return null;

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.full_name,
          email: user.email,
          role: user.role,
          sector: user.sector_id,
          guiche: user.guiche_id || DEFAULT_GUICHE,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.sector = user.sector;
        token.guiche = user.guiche;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub;
      session.user.role = token.role;
      session.user.sector = token.sector;
      session.user.guiche = token.guiche;
      session.user.initials = session.user.name
        ? initials(session.user.name)
        : "";
      return session;
    },
    async authorized({ auth }) {
      return !!auth?.user;
    },
  },
});
