import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    authUserId: text("auth_user_id").unique(),
    login: text("login").notNull().unique(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull().unique(),
    phone: text("phone").notNull().default(""),
    role: text("role").notNull().default("viewer"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("profiles_status_idx").on(table.status),
    index("profiles_email_idx").on(table.email),
  ],
);

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  data: text("data").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
