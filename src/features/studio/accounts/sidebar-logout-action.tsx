"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { StudioSessionDto } from "../contracts";
import {
  useStudioLeaveGate,
  useStudioLeaveProtection,
} from "../navigation-boundary";
import { useStudioMobileNavigation } from "../mobile-navigation";
import { useOwnedStudioSession, useStudioAccountOwner } from "./session-owner";
import { useCurrentStudioLogout } from "./use-current-logout";
import { AccountOverlay } from "./account-ui";
import { operatorName } from "./presentation";
import styles from "./experience.module.css";

/** The portal changes only placement; authority remains with the shell's owner. */
export function SidebarLogoutAction({
  session: initialSession,
}: {
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession),
    owner = useStudioAccountOwner();
  const gate = useStudioLeaveGate(),
    navigation = useStudioMobileNavigation();
  const [slot, setSlot] = useState<HTMLElement | null>(null),
    [open, setOpen] = useState(false);
  // The hook revokes locally before awaiting the response; leave protection then
  // keeps the document until the response has settled.
  const logout = useCurrentStudioLogout(session);
  const protection = useStudioLeaveProtection({
    dirty: false,
    pending: logout.busy,
  });
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setSlot(document.getElementById("studio-sidebar-logout"));
    });
    return () => {
      active = false;
    };
  }, []);
  function launch() {
    if (logout.busy || owner?.revoked || !gate()) return;
    navigation.close();
    logout.clearMessage();
    setOpen(true);
  }
  return (
    <>
      {slot &&
        createPortal(
          <button
            type="button"
            className={styles.sidebarLogout}
            disabled={logout.busy || Boolean(owner?.revoked)}
            onClick={launch}
          >
            退出当前登录
          </button>,
          slot,
        )}
      <AccountOverlay
        open={open}
        variant="modal"
        size="short"
        title="退出当前登录"
        description={`${operatorName(session.operator)} · ${session.operator.loginName}`}
        onClose={() => setOpen(false)}
        canClose={!logout.busy}
        footer={
          <>
            <button onClick={() => setOpen(false)} disabled={logout.busy}>
              保留登录
            </button>
            <button
              className={styles.danger}
              disabled={logout.busy || Boolean(owner?.revoked)}
              onClick={() => {
                if (gate()) void logout.submit(protection.markSaved);
              }}
            >
              {logout.busy ? "正在退出…" : "确认退出当前登录"}
            </button>
          </>
        }
      >
        <p className={`${styles.hint} ${styles.warn}`}>
          确认后只退出当前登录，其他设备不受影响。待核实的原业务操作不会自动重发。
        </p>
        {logout.message && (
          <p className={styles.error} role="alert">
            {logout.message}
          </p>
        )}
      </AccountOverlay>
    </>
  );
}
