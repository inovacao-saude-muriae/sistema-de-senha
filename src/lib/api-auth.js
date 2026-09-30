import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ROLES } from "./constants.js";

/**
 * Authorization helpers for route handlers.
 *
 * `middleware.js` skips every `/api` path, so these are the only barrier for
 * API routes — each handler must call one of these explicitly.
 *
 * `auth()` in a route decodes the session from the session cookie; there is no
 * extra database round-trip.
 *
 * Usage:
 *   const { error } = await requireRole();
 *   if (error) return error;
 */

/**
 * Require any authenticated user.
 * @returns {Promise<{ session?: object, error?: NextResponse }>}
 */
export async function requireSession() {
  const session = await auth();

  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  return { session };
}

/**
 * Require an authenticated user with a specific role.
 * @param {'admin'|'attendant'} [role]
 * @returns {Promise<{ session?: object, error?: NextResponse }>}
 */
export async function requireRole(role = ROLES.ADMIN) {
  const { session, error } = await requireSession();
  if (error) return { error };

  if (session.user.role !== role) {
    return {
      error: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  return { session };
}
