import { auth } from "@/src/auth";
import { requireAdmin } from "@/src/security";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const admin = await requireAdmin();
  if (admin.deny) return admin.deny;

  const db = (auth as unknown as { options: { database: import("better-sqlite3").Database } }).options.database;
  const users = db.prepare("SELECT id, name, email, role, createdAt FROM user ORDER BY createdAt DESC").all();
  return Response.json(users);
}
