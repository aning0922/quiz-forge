import type { Metadata } from "next";
import { SetPasswordPage } from "@/features/studio/accounts/set-password-page";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "本人设置密码",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <SetPasswordPage />;
}
