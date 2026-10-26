"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { StudioClientError, studioFetch, studioMessage } from "./client";
import type { StudioPreauthDto, StudioSessionDto } from "./contracts";
import { ArrowRight } from "lucide-react";
import { EntryScene } from "./accounts/entry-scene";
import styles from "./accounts/entry.module.css";
import { PasswordField } from "./accounts/password-field";
import { invalidateStudioAuthority } from "./authority-events";

export function StudioLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loginName, setLoginName] = useState("");
  const [preauth, setPreauth] = useState<StudioPreauthDto | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("正在准备登录…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    studioFetch<StudioPreauthDto>("/api/studio/auth/preauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then((value) => {
        if (active) {
          setPreauth(value);
          setMessage("请输入登录账号和密码。");
        }
      })
      .catch((error) => {
        if (active) {
          if (
            error instanceof StudioClientError &&
            error.code === "ALREADY_AUTHENTICATED"
          )
            router.replace("/studio");
          else {
            setMessage(studioMessage(error));
            setFailed(true);
          }
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function prepare() {
    setBusy(true);
    setFailed(false);
    setPassword("");
    setPreauth(null);
    setMessage("正在准备登录…");
    try {
      const value = await studioFetch<StudioPreauthDto>(
        "/api/studio/auth/preauth",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      setPreauth(value);
      setMessage("请输入登录账号和密码。");
    } catch (error) {
      if (
        error instanceof StudioClientError &&
        error.code === "ALREADY_AUTHENTICATED"
      )
        router.replace("/studio");
      else {
        setMessage(studioMessage(error));
        setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preauth || busy) return;
    invalidateStudioAuthority();
    setBusy(true);
    setFailed(false);
    setMessage("正在登录…");
    const input = password;
    setPassword("");
    try {
      await studioFetch<StudioSessionDto>("/api/studio/auth/password-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": preauth.csrfToken,
        },
        body: JSON.stringify({ loginName, password: input }),
      });
      router.replace("/studio");
      router.refresh();
    } catch (error) {
      setMessage(studioMessage(error));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <EntryScene
      kind="login"
      eyebrow="WELCOME BACK"
      title="登录运营管理空间"
      description="使用运营账号与密码登录，访问范围由你的角色决定。"
    >
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field} htmlFor="studio-login-name">
          登录账号
          <input
            id="studio-login-name"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={64}
            placeholder="例如 admin.qf"
            value={loginName}
            disabled={busy || !preauth}
            onChange={(event) => setLoginName(event.target.value)}
          />
        </label>
        <PasswordField
          label="密码"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy || !preauth}
        />
        <button
          className={`${styles.button} ${styles.primary}`}
          disabled={busy || !preauth || !password || !loginName.trim()}
          type="submit"
        >
          {busy ? "请稍候…" : "登录 Studio"}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </form>
      <p
        id="studio-status"
        className={`${styles.status} ${failed ? styles.error : ""}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      {failed && (
        <button
          className={styles.button}
          disabled={busy}
          onClick={prepare}
          type="button"
        >
          重新准备登录
        </button>
      )}
      <p className={styles.prompt}>
        忘记密码？请联系管理员获取一次性重置入口。
      </p>
    </EntryScene>
  );
}
