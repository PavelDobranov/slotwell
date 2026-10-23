import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export function openDatabase(filename: string) {
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");

  return { sqlite, db: drizzle({ client: sqlite }) };
}
