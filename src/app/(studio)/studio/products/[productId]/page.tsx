import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import {
  ProductTaskWorkspace,
  type TaskTab,
} from "@/features/studio/product-workspace/task-workspace";

export default async function StudioProductPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const query = await searchParams;
  const task = query.task;
  const initialTask: TaskTab =
    task === "preview" || task === "review" || task === "testing"
      ? task
      : "content";
  return (
    <ProductTaskWorkspace session={state.session} initialTask={initialTask} />
  );
}
