import { NextResponse } from "next/server";

/**
 * Endpoints de autenticação ficam em /api/auth/[...nextauth].
 *
 * O antigo POST /api/auth (caminho de credenciais paralelo ao NextAuth) foi
 * removido: nenhum cliente o usava, ele não emitia cookie de sessão e verificava
 * credenciais sem rate limiting — um segundo caminho de login que só ampliava a
 * superfície de ataque por brute force.
 */
export async function GET() {
  return NextResponse.json({ users: [] });
}
