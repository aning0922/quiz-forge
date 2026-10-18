"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { StudioClientError, studioFetch, studioMessage } from "./client";
import type { StudioPreauthDto, StudioSessionDto } from "./contracts";
import styles from "./studio.module.css";
import { invalidateStudioAuthority } from "./authority-events";

export function StudioLoginForm() {
  const router = useRouter();
  const [credential, setCredential] = useState("");
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
          setMessage("登录验证已准备，请输入本机生成的运营凭证。");
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
      setMessage("登录验证已准备，请输入本机生成的运营凭证。");
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
      await studioFetch<StudioSessionDto>("/api/studio/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": preauth.csrfToken,
        },
        body: JSON.stringify({ credential: input }),
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
    <section className={styles.panel}>
      <h1>运营登录</h1>
      <p className={styles.intro}>
        使用本机维护者生成的专属运营凭证。普通买家的测评访问凭证不用于此处。
      </p>
      <form className={styles.form} onSubmit={submit}>
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
        <button
          className={styles.button}
          disabled={busy || !preauth || !credential}
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
      <p className={styles.note}>
        仅用于本机 HTTP 内测。登录验证 5 分钟有效；会话空闲 30 分钟或登录满 8
        小时后失效。
      </p>
    </section>
  );
}
