import { z } from "zod";
import { studioRoles } from "../role-policy";
const uuid = z.uuid(),
  revision = z.number().int().min(1).max(2147483647);
export const displayName = z
  .string()
  .transform((s) => s.trim())
  .refine(
    (s) =>
      [...s].length >= 1 &&
      [...s].length <= 80 &&
      !/[\u0000-\u001f\u007f-\u009f<>]/u.test(s) &&
      new TextDecoder().decode(new TextEncoder().encode(s)) === s,
  );
export const loginName = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/));
const base = { operationId: uuid, expectedRevision: revision };
export const createAccountInput = z.strictObject({
  operationId: uuid,
  loginName,
  displayName,
  role: z.enum(studioRoles),
});
export const changeAccountInput = z.discriminatedUnion("action", [
  z.strictObject({ ...base, action: z.literal("display-name"), displayName }),
  z.strictObject({
    ...base,
    action: z.literal("role"),
    role: z.enum(studioRoles),
  }),
  z.strictObject({ ...base, action: z.literal("disable") }),
  z.strictObject({ ...base, action: z.literal("restore") }),
]);
export const tokenInput = z.strictObject({
  ...base,
  purpose: z.enum(["setup", "reset"]),
});
export const revokeInput = z.strictObject(base);
export const operationInput = z.strictObject({ operationId: uuid });
export const passwordLoginInput = z.strictObject({
  loginName,
  password: z.string().max(2048),
});
export const setupInspectInput = z.strictObject({ token: z.string().max(100) });
export const setupInput = z.strictObject({
  token: z.string().max(100),
  operationId: uuid,
  password: z.string().max(2048),
});
export const setupResultInput = z.strictObject({
  token: z.string().max(100),
  operationId: uuid,
});
export const passwordChangeInput = z.strictObject({
  operationId: uuid,
  currentPassword: z.string().max(2048),
  newPassword: z.string().max(2048),
});
export const listInput = z.strictObject({
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  q: z.string().max(80).default(""),
  status: z.enum(["all", "active", "pending", "disabled"]).default("all"),
});
export const auditInput = z.strictObject({
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
