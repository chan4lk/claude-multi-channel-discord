import { auth } from "./auth";
import db from "./db";

export async function seedAdminIfNeeded(): Promise<void> {
  const email = process.env.MC_ADMIN_EMAIL;
  const password = process.env.MC_ADMIN_PASSWORD;
  if (!email || !password) return;

  try {
    const existing = db.prepare("SELECT COUNT(*) as count FROM user").get() as { count: number };
    if (existing.count > 0) return;

    await auth.api.signUpEmail({
      body: { name: "Admin", email, password },
    });
    console.log("[mcd] Admin user seeded:", email);
  } catch (err) {
    console.warn("[mcd] Admin seed skipped:", (err as Error).message);
  }
}
