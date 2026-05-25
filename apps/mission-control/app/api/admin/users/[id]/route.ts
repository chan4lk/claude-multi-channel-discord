import { auth } from "@/src/auth";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const db = (auth as unknown as { options: { database: import("better-sqlite3").Database } }).options.database;

  if (session.user.id === id) {
    return Response.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const user = db.prepare("SELECT id FROM user WHERE id = ?").get(id);
  if (!user) return Response.json({ error: "User not found" }, { status: 404 });

  db.prepare("DELETE FROM session WHERE userId = ?").run(id);
  db.prepare("DELETE FROM account WHERE userId = ?").run(id);
  db.prepare("DELETE FROM user WHERE id = ?").run(id);

  return Response.json({ ok: true });
}
