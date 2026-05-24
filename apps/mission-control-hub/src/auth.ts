import db from "./db";

export function validateApiKey(key: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM instances WHERE api_key = ? LIMIT 1")
    .get(key);
  return row !== null;
}
