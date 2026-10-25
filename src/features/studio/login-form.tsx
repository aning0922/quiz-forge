"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { StudioClientError, studioFetch, studioMessage } from "./client";
import type { StudioPreauthDto, StudioSessionDto } from "./contracts";
import styles from "./studio.module.css";
import { PasswordField } from "./accounts/password-field";
import accountStyles from "./accounts/accounts.module.css";
import Link from "next/link";
import { invalidateStudioAuthority } from "./authority-events";

export function StudioLoginForm({ legacy = false }: { legacy?: boolean }) {
  const router = useRouter();
  const [credential, setCredential] = useState("");
  const [loginName, setLoginName] = useState("");
  const [preauth, setPreauth] = useState<StudioPreauthDto | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("正在准备登录验证…");
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
          setMessage(
            legacy
              ? "登录验证已准备，请输入尚未切换的旧运营凭证。"
              : "登录验证已准备，请输入登录账号和密码。",
          );
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
  }, [router, legacy]);

  async function prepare() {
    setBusy(true);
    setFailed(false);
    setCredential("");
    setPreauth(null);
    setMessage("正在准备登录验证…");
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
      setMessage(
        legacy
          ? "登录验证已准备，请输入尚未切换的旧运营凭证。"
          : "登录验证已准备，请输入登录账号和密码。",
      );
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
    setMessage("正在验证运营身份…");
    const input = credential;
    setCredential("");
    try {
      await studioFetch<StudioSessionDto>(
        legacy ? "/api/studio/auth/login" : "/api/studio/auth/password-login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": preauth.csrfToken,
          },
          body: JSON.stringify(
            legacy ? { credential: input } : { loginName, password: input },
          ),
        },
      );
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
      <h1>{legacy ? "旧凭证迁移登录" : "后台账号登录"}</h1>
      <p className={styles.intro}>
        {legacy
          ? "仅供尚未切换账号密码的原身份使用；旧凭证不授予管理员权限。"
          : "登录账号与显示名称不同。请使用管理员开通的唯一账号登录。"}
      </p>
      <form className={styles.form} onSubmit={submit}>
        {legacy ? (
          <>
            <label htmlFor="studio-credential">运营凭证</label>
            <input
              id="studio-credential"
              className={styles.input}
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              maxLength={128}
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              disabled={busy || !preauth}
              required
              aria-describedby="studio-status"
            />
          </>
        ) : (
          <>
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
              value={credential}
              onChange={setCredential}
              autoComplete="current-password"
              disabled={busy || !preauth}
            />
          </>
        )}
        <button
          className={styles.button}
          disabled={
            busy || !preauth || !credential || (!legacy && !loginName.trim())
          }
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
          重新准备登录验证
        </button>
      )}
      <Link href={legacy ? "/studio/login" : "/studio/login/legacy"}>
        {legacy ? "返回账号密码登录" : "使用尚未切换的旧凭证"}
      </Link>
      <p className={styles.note}>
        仅用于本机 HTTP 内测。登录验证 5 分钟有效；会话空闲 30 分钟或登录满 8
        小时后失效。
      </p>
    </section>
  );
}
