import { auth } from "@/src/auth";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const db = (auth as unknown as { options: { database: import("better-sqlite3").Database } }).options.database;
  const users = db.prepare("SELECT id, name, email, createdAt FROM user ORDER BY createdAt DESC").all();
  return Response.json(users);
}
