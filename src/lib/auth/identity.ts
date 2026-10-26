import { z } from "zod";
import { studioRoles } from "./role-policy";
import { displayName, loginName } from "./accounts/input";

/** Current identity values must already be canonical; reading never repairs identity. */
const canonical = (schema: typeof loginName | typeof displayName) =>
  z.string().refine((value) => {
    const parsed = schema.safeParse(value);
    return parsed.success && parsed.data === value;
  });

export const studioOperatorIdentitySchema = z.strictObject({
  id: z.uuid(),
  loginName: canonical(loginName),
  displayName: canonical(displayName),
  role: z.enum(studioRoles),
  accountRevision: z.number().int().min(1).max(2147483647),
});
export type StudioOperatorIdentity = z.infer<
  typeof studioOperatorIdentitySchema
>;
