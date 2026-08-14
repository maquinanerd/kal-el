import { desc, eq } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { users } from "@kal-el/db/schema";
import type { CreateUserBody } from "@kal-el/contracts";
import { hashPassword } from "@kal-el/auth";

import { conflict, isUniqueViolation, notFound } from "../plugins/errors.js";

export function toUserDto(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createUser(db: Db, body: CreateUserBody) {
  const passwordHash = await hashPassword(body.password);
  try {
    const [row] = await db
      .insert(users)
      .values({ email: body.email, name: body.name, passwordHash })
      .returning();
    if (!row) throw new Error("createUser returned no row");
    return toUserDto(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(`email "${body.email}" is already registered`, { field: "email" });
    }
    throw err;
  }
}

export async function listUsers(db: Db) {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  return rows.map(toUserDto);
}

export async function getUserById(db: Db, userId: string) {
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) throw notFound("user not found");
  return toUserDto(row);
}
