import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import db from "./db";

const dbPath = process.env.MC_DB_PATH ?? "mc.db";

export const auth = betterAuth({
  database: new Database(dbPath),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
});

export function validateApiKey(key: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM instances WHERE api_key = ? LIMIT 1")
    .get(key);
  return row !== null;
}
