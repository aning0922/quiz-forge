"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { StudioClientError, studioFetch, studioMessage } from "./client";
import type { StudioPreauthDto, StudioSessionDto } from "./contracts";
import styles from "./studio.module.css";
import { PasswordField } from "./accounts/password-field";
import accountStyles from "./accounts/accounts.module.css";
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
    <section
      className={`${styles.panel} ${accountStyles.page}`}
      data-studio-entry="login"
    >
      <h1>后台账号登录</h1>
      <p className={styles.intro}>
        登录账号与显示名称不同。请使用管理员开通的唯一账号登录。
      </p>
      <form className={styles.form} onSubmit={submit}>
        <label htmlFor="studio-login-name">登录账号</label>
        <input
          id="studio-login-name"
          name="username"
          className={styles.input}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={64}
          value={loginName}
          disabled={busy || !preauth}
          onChange={(event) => setLoginName(event.target.value)}
        />
        <PasswordField
          label="密码"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy || !preauth}
        />
        <button
          className={styles.button}
          disabled={busy || !preauth || !password || !loginName.trim()}
          type="submit"
        >
          {busy ? "请稍候…" : "登录 Studio"}
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
      <p className={styles.note}>
        登录页面停留过久时，请重新准备登录后再试。登录后空闲30分钟或满8小时需重新登录。
      </p>
    </section>
  );
}
