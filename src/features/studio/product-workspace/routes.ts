import { z } from "zod";
import type { RevisionTarget } from "@/features/product/internal-versions/identity-contracts";

export const workspaceTasks = [
  "content",
  "preview",
  "review",
  "testing",
] as const;
export type WorkspaceTask = (typeof workspaceTasks)[number];
const revision = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/)
  .transform(Number)
  .pipe(z.number().int().max(2_147_483_647));
/** URL identity selects one immutable revision; it is never permission or a write receipt. */
export const workspaceQuerySchema = z
  .strictObject({
    task: z.enum(workspaceTasks).default("content"),
    draftId: z.uuid().optional(),
    revision: revision.optional(),
  })
  .superRefine((value, context) => {
    if ((value.draftId === undefined) !== (value.revision === undefined))
      context.addIssue({
        code: "custom",
        message: "草稿编号和修订号必须同时指定。",
      });
    if (value.draftId && value.task !== "preview" && value.task !== "review")
      context.addIssue({
        code: "custom",
        message: "固定修订只能定位预览或审核任务。",
      });
  });
export type WorkspaceQuery = z.infer<typeof workspaceQuerySchema>;

export function productWorkspaceHref(
  productId: string,
  task: WorkspaceTask,
  target?: Pick<RevisionTarget, "draftId" | "revision">,
) {
  const raw = {
    task,
    ...(target
      ? { draftId: target.draftId, revision: String(target.revision) }
      : {}),
  };
  workspaceQuerySchema.parse(raw);
  return `/studio/products/${encodeURIComponent(productId)}?${new URLSearchParams(raw)}`;
}
