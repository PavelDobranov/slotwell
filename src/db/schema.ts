import { integer, pgTable, text } from "drizzle-orm/pg-core";

export const scaffoldChecks = pgTable("scaffold_checks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  label: text("label").notNull(),
});
