import { headers } from "next/headers";
import { auth } from "./auth";

/**
 * Validates the caller's better-auth session server-side.
 *
 * middleware.ts only checks that a session cookie is *present* — it does not
 * verify the token. Any route that performs a privileged or mutating action
 * must call this so a forged/expired cookie cannot pass. Returns a 401 Response
 * to return directly, or null when the session is valid.
 */
export async function requireSession(): Promise<Response | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

/** A slug is safe iff it contains only [a-z0-9_-]; blocks path traversal and shell metachars. */
export function isSafeSlug(slug: unknown): slug is string {
  return typeof slug === "string" && /^[a-z0-9_-]+$/i.test(slug);
}
