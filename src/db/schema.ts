import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const scaffoldChecks = sqliteTable("scaffold_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
});
