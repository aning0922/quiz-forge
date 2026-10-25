"use client";
import { useId, useState } from "react";
import styles from "./accounts.module.css";
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  disabled?: boolean;
}) {
  const id = useId(),
    [visible, setVisible] = useState(false);
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.password}>
        <input
          id={id}
          name={
            autoComplete === "current-password" ? "password" : "new-password"
          }
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="none"
          required
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          disabled={disabled}
          aria-label={`${visible ? "隐藏" : "显示"}${label}`}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? "隐藏" : "显示"}
        </button>
      </div>
    </div>
  );
}
