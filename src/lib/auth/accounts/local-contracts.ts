import { z } from "zod";
import { studioOperatorIdentitySchema } from "../identity";

const revision = studioOperatorIdentitySchema.shape.accountRevision;
const base = { operationId: z.uuid(), targetId: z.uuid() };
export const localAccountBindingSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...base,
    action: z.literal("bootstrap-admin"),
    loginName: studioOperatorIdentitySchema.shape.loginName,
    displayName: studioOperatorIdentitySchema.shape.displayName,
  }),
  z.strictObject({
    ...base,
    action: z.literal("admin-recovery"),
    expectedRevision: revision,
  }),
  z.strictObject({
    ...base,
    action: z.literal("disable"),
    expectedRevision: revision,
  }),
  z.strictObject({
    ...base,
    action: z.literal("restore"),
    expectedRevision: revision,
  }),
]);
export type LocalAccountBinding = z.infer<typeof localAccountBindingSchema>;
export const localAccountResultSchema = z.strictObject({
  changed: z.boolean(),
  previousRevision: revision.nullable(),
  resultingRevision: revision,
  resultingStatus: z.enum(["pending", "active", "disabled"]),
});
export const localAccountReceiptSchema = z
  .strictObject({
    operation: z.strictObject({
      operationId: z.uuid(),
      action: z.enum([
        "bootstrap-admin",
        "admin-recovery",
        "disable",
        "restore",
      ]),
      actorId: z.null(),
      targetId: z.uuid(),
      status: z.enum(["completed", "rejected"]),
      errorCode: z.string().min(1).max(64).nullable(),
      createdAt: z.iso.datetime({ precision: 3 }),
    }),
    binding: localAccountBindingSchema,
    result: localAccountResultSchema,
  })
  .superRefine(({ operation: op, binding: b, result: r }, ctx) => {
    const reject = () =>
      ctx.addIssue({
        code: "custom",
        message: "Invalid local account receipt",
      });
    if (
      op.operationId !== b.operationId ||
      op.targetId !== b.targetId ||
      op.action !== b.action ||
      (op.status === "completed") !== (op.errorCode === null)
    )
      reject();
    if (b.action === "bootstrap-admin") {
      if (
        !r.changed ||
        r.previousRevision !== null ||
        r.resultingRevision !== 1 ||
        r.resultingStatus !== "pending" ||
        op.status !== "completed"
      )
        reject();
    } else {
      if (
        r.previousRevision === null ||
        r.resultingRevision !== r.previousRevision + (r.changed ? 1 : 0) ||
        (r.changed && op.status !== "completed") ||
        (op.status === "completed" && r.previousRevision !== b.expectedRevision)
      )
        reject();
    }
  });
export type LocalAccountReceipt = z.infer<typeof localAccountReceiptSchema>;
