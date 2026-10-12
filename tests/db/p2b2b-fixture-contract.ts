import { z } from "zod";
const credential = z.strictObject({
  identifier: z.uuid(),
  secret: z.string().regex(/^qfo_p2a_[A-Za-z0-9_-]{43}$/),
});
export const p2b2bFixtureSchema = z
  .strictObject({
    version: z.literal(1),
    runId: z.uuid(),
    operator: credential,
    readOnly: credential,
    productId: z.string().regex(/^e2e-validations-[0-9a-f]{8}$/),
    imports: z
      .array(
        z.strictObject({
          importId: z.uuid(),
          expectedImportStateRevision: z.number().int().min(1).max(2147483647),
          archiveSha256: z.string().regex(/^[0-9a-f]{64}$/),
          archiveBytes: z.number().int().min(1).max(33_554_432),
        }),
      )
      .length(3),
  })
  .refine(
    (v) =>
      new Set(v.imports.map((i) => i.importId)).size === 3 &&
      v.operator.identifier !== v.readOnly.identifier &&
      v.productId === `e2e-validations-${v.runId.slice(0, 8)}`,
  );
/** Only strict absence is sufficient; permission errors and a reused PID are still present. ACK remains separately mandatory. */
export function ownerAbsent(pid: number) {
  if (!Number.isInteger(pid) || pid < 1 || pid > 2147483647) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
