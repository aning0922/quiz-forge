import Link from "next/link";
import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { AccountAuditPage } from "@/features/studio/accounts/audit-page";
import { roleHasCapability } from "@/lib/auth/role-policy";
export default async function Page() {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  return roleHasCapability(state.session.operator.role, "account:audit") ? (
    <AccountAuditPage />
  ) : (
    <p>
      当前身份不能查看账号操作记录。<Link href="/studio/session">我的账号</Link>
    </p>
  );
}
