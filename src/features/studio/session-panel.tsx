"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { StudioSessionDto } from "./contracts";
import { StudioClientError, studioFetch, studioMessage } from "./client";
import styles from "./studio.module.css";
import { invalidateStudioAuthority } from "./authority-events";

function expiry(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

export function StudioSessionPanel({ session }: { session: StudioSessionDto }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function logout() {
    if (busy) return;
    invalidateStudioAuthority();
    setBusy(true);
    setMessage("正在退出…");
    try {
      await studioFetch<void>("/api/studio/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: "{}",
      });
      router.replace("/studio/login");
      router.refresh();
    } catch (error) {
      if (
        error instanceof StudioClientError &&
        error.code === "UNAUTHENTICATED"
      ) {
        router.replace("/studio/login");
        router.refresh();
      } else setMessage(studioMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel}>
      <h1>运营会话</h1>
      <p className={styles.intro}>
        当前身份来自本地数据库中的有效运营会话。选择工作区开始整理商品。
      </p>
      <div className={styles.sessionActions}>
        <Link className={styles.link} href="/studio/products">
          打开商品列表
        </Link>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>运营标识</dt>
          <dd>{session.operator.label}</dd>
        </div>
        <div>
          <dt>权限角色</dt>
          <dd>
            {session.operator.role === "operator"
              ? "运营者（operator）"
              : "只读（read-only）"}
          </dd>
        </div>
        <div>
          <dt>空闲到期（北京时间）</dt>
          <dd>
            <time dateTime={session.idleExpiresAt}>
              {expiry(session.idleExpiresAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>绝对到期（北京时间）</dt>
          <dd>
            <time dateTime={session.absoluteExpiresAt}>
              {expiry(session.absoluteExpiresAt)}
            </time>
          </dd>
        </div>
      </dl>
      <button
        className={styles.button}
        disabled={busy}
        onClick={logout}
        type="button"
      >
        {busy ? "正在退出…" : "退出登录"}
      </button>
      {message && (
        <p className={styles.status} role="status" aria-live="polite">
          {message}
        </p>
      )}
      <p className={styles.note}>
        商品工作区串联原包导入、草稿修订、固定预览、审核版本与内测发码。运营身份独立于消费者测评访问凭证。
      </p>
    </section>
  );
}
