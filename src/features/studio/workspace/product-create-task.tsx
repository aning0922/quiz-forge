"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import type { StudioSessionDto } from "../contracts";
import { ProductCreateForm, type ProductCreateState } from "./product-create";
import styles from "./product-create-task.module.css";

const initial: ProductCreateState = {
  dirty: false,
  busy: false,
  pending: false,
  revoked: false,
};
const Context = createContext<{
  show: (trigger: HTMLButtonElement) => void;
  state: ProductCreateState;
  open: boolean;
} | null>(null);

/** One creation owner per page, outside catalog query/loading/error branches. */
export function ProductCreateTask({
  session,
  children,
}: {
  session?: StudioSessionDto | undefined;
  children: ReactNode;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const stateRef = useRef(initial);
  const [state, setState] = useState(initial);
  const [started, setStarted] = useState(false);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const report = useCallback((next: ProductCreateState) => {
    const old = stateRef.current;
    stateRef.current = next;
    if (
      old.busy !== next.busy ||
      old.dirty !== next.dirty ||
      old.pending !== next.pending ||
      old.revoked !== next.revoked
    )
      setState(next);
  }, []);
  const close = useCallback(() => {
    if (stateRef.current.busy) {
      setNotice("正在提交或核实原操作，请等待结果。原输入仍保留。");
      return;
    }
    dialog.current?.close();
    setOpen(false);
    setNotice("");
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
      else
        document
          .querySelector<HTMLButtonElement>("[data-create-trigger]")
          ?.focus();
    });
  }, []);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) node.showModal();
  }, [open, started]);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    // Native listener also covers footer portal targets outside the form owner.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !node.open) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    node.addEventListener("keydown", escape);
    return () => node.removeEventListener("keydown", escape);
  }, [started, close]);
  useEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [open]);
  const available = session?.operator.role === "operator";
  return (
    <Context.Provider
      value={
        available
          ? {
              show: (button) => {
                trigger.current = button;
                setStarted(true);
                setNotice("");
                setOpen(true);
              },
              state,
              open,
            }
          : null
      }
    >
      {!open && (state.dirty || state.pending || state.revoked) && (
        <aside className={styles.retained} role="status">
          <p>
            {state.revoked
              ? "原创建任务失权，输入仍保留"
              : state.pending
                ? "创建结果待核实，原请求仍保留"
                : "本页保留着未提交的创建输入"}
          </p>
          <button
            className={styles.secondary}
            type="button"
            data-create-trigger
            onClick={(event) => {
              trigger.current = event.currentTarget;
              setOpen(true);
            }}
          >
            继续新建测评
          </button>
        </aside>
      )}
      {children}
      {started && session && (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby={`${id}-title`}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const r = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < r.left ||
              event.clientX > r.right ||
              event.clientY < r.top ||
              event.clientY > r.bottom
            )
              close();
          }}
        >
          <header className={styles.header}>
            <div>
              <h2 id={`${id}-title`}>新建测评</h2>
              <p>创建作品工作区后，继续导入内容包与管理修订。</p>
            </div>
            <button
              className={styles.close}
              type="button"
              aria-label="收起新建测评"
              onClick={close}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
          <div className={styles.body}>
            <ProductCreateForm
              session={session}
              embedded
              actionsHost={actionsHost}
              onStateChange={report}
            />
          </div>
          <footer className={styles.footer}>
            <button className={styles.secondary} type="button" onClick={close}>
              先返回
            </button>
            <div ref={setActionsHost} className={styles.actions} />
          </footer>
        </dialog>
      )}
    </Context.Provider>
  );
}

export function ProductCreateAction() {
  const task = useContext(Context);
  if (!task)
    return (
      <Link className={styles.primary} href="/studio/new-product">
        <Plus size={18} aria-hidden="true" />
        新建测评
      </Link>
    );
  const retained = task.state.dirty || task.state.pending || task.state.revoked;
  return (
    <div className={styles.launcher}>
      <button
        className={styles.primary}
        type="button"
        data-create-trigger
        onClick={(event) => task.show(event.currentTarget)}
      >
        <Plus size={18} aria-hidden="true" />
        {retained ? "继续新建测评" : "新建测评"}
      </button>
    </div>
  );
}
