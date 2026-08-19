import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common";

/**
 * Addresses are stored and compared lower-case.
 *
 * The create path inserted the address verbatim while login looked it up lower-cased, so an
 * account created as Alice@Example.com could never authenticate - and there is no user
 * update endpoint. Through bootstrap it was terminal: the route is one-shot, so a
 * deployment bootstrapped with a capitalised address could neither log in nor re-run it.
 */
const emailSchema = z.string().email().transform((v) => v.trim().toLowerCase());

export const userStatusSchema = z.enum(["active", "invited", "disabled"]);

export const userSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  name: z.string().min(1).max(120),
  status: userStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createUserBodySchema = z
  .object({
    email: emailSchema,
    name: z.string().min(1).max(120),
    password: z.string().min(12).max(128),
  })
  .strict();

export const loginBodySchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1),
  })
  .strict();

export const roleSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema.nullable(),
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

export const createRoleBodySchema = z
  .object({
    key: roleSchema.shape.key,
    name: roleSchema.shape.name,
    description: z.string().max(500).optional(),
    permissions: z.array(z.string().min(1).max(80)).min(1),
  })
  .strict();

export const permissionKeySchema = z.string().min(1).max(80);

export const serviceTokenSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1).max(80)),
  expiresAt: timestampSchema.nullable(),
  lastUsedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export const createServiceTokenBodySchema = z
  .object({
    name: serviceTokenSchema.shape.name,
    scopes: z.array(z.string().min(1).max(80)).min(1),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export const sessionSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
});

export type User = z.infer<typeof userSchema>;
export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type Role = z.infer<typeof roleSchema>;
export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;
export type ServiceToken = z.infer<typeof serviceTokenSchema>;
export type CreateServiceTokenBody = z.infer<typeof createServiceTokenBodySchema>;
