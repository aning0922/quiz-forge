"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import type { StudioRole } from "@/lib/auth/role-policy";
import type { AccountStatus } from "./contracts";
import { roleLabel } from "./presentation";
import styles from "./experience.module.css";

export function AccountAvatar({
  name,
  tone = "purple",
}: {
  name: string;
  tone?: "purple" | "blue" | "green" | "sand";
}) {
  return (
    <span className={`${styles.avatar} ${styles[tone]}`} aria-hidden="true">
      {Array.from(name.trim() || "Q")[0]}
    </span>
  );
}
export function RoleBadge({ role }: { role: StudioRole }) {
  return (
    <span className={`${styles.roleBadge} ${styles[role]}`}>
      {roleLabel(role)}
    </span>
  );
}
export function StatusBadge({ status }: { status: AccountStatus }) {
  return (
    <span className={`${styles.statusBadge} ${styles[status]}`}>
      {{ active: "可登录", pending: "待设置密码", disabled: "已停用" }[status]}
    </span>
  );
}

/** One native modal layer. Visibility never remounts its task or settles a write. */
export function AccountOverlay({
  open,
  variant,
  title,
  description,
  children,
  footer,
  onClose,
  canClose = true,
}: {
  open: boolean;
  variant: "drawer" | "modal";
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  canClose?: boolean;
}) {
  const id = useId(),
    dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      node.showModal();
    } else if (!open && node?.open) {
      node.close();
      if (opener.current?.isConnected) opener.current.focus();
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const before = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = before;
    };
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className={`${styles.overlay} ${styles[variant]}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (canClose) onClose();
      }}
      onClick={(event) => {
        if (!canClose || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header className={styles.overlayHeader}>
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          {description && <p id={`${id}-description`}>{description}</p>}
        </div>
        <button
          type="button"
          className={styles.close}
          aria-label={`关闭${title}`}
          disabled={!canClose}
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.overlayBody}>{children}</div>
      {footer && <footer className={styles.overlayFooter}>{footer}</footer>}
    </dialog>
  );
}
