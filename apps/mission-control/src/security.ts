import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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

/** True for loopback / private / link-local / unspecified IP literals (v4 + v6). */
function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    const [a, b] = p as [number, number, number, number];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // link-local + AWS metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
    // IPv4-mapped (::ffff:a.b.c.d) — extract and re-check.
    const m = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]!);
    return false;
  }
  return true; // not a recognized literal — treat as unsafe
}

/**
 * Guards a user-supplied webhook URL against SSRF. Requires https and
 * resolves the host, rejecting any address that maps to a private, loopback,
 * or link-local range (e.g. the cloud metadata endpoint). Returns an error
 * string to reject with, or null when the URL is safe to fetch.
 */
export async function assertSafeWebhookUrl(raw: string): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "invalid URL";
  }
  if (u.protocol !== "https:") return "webhook URL must use https";
  const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (isIP(host)) {
    return isPrivateIp(host) ? "webhook host resolves to a private address" : null;
  }
  let addrs;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return "webhook host did not resolve";
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    return "webhook host resolves to a private address";
  }
  return null;
}
