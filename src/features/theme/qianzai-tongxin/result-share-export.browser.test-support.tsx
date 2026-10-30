/** UI contract double only. No production import resolves here. PNGs are marked
 * synthetic fixtures; export-owner/real renderer evidence belongs to A. */
import { useSyncExternalStore } from "react";
import type {
  QianzaiExportArtifact,
  QianzaiExportContextValue,
  QianzaiExportErrorCode,
  QianzaiExportKind,
  QianzaiShareOutcome,
} from "@/features/report/qianzai-tongxin/contracts";
const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as { bindings: { slot: string; url: string }[] };
const listeners = new Set<() => void>(),
  cache = new Map<
    QianzaiExportKind,
    { blob: Blob; artifact: QianzaiExportArtifact }
  >();
let epoch = 0,
  hold = false,
  release: (() => void) | undefined,
  fail: QianzaiExportErrorCode | null = null,
  outcome: QianzaiShareOutcome = "download-required";
const renders = { poster: 0, "full-report": 0 },
  actions = { download: 0, share: 0 };
const notify = () => {
  value = { ...value };
  for (const listener of listeners) listener();
};
const close = () => {
  epoch++;
  for (const c of cache.values()) URL.revokeObjectURL(c.artifact.previewUrl);
  cache.clear();
  value = { ...value, state: { phase: "closed" } };
  notify();
};
const valueStart = (): QianzaiExportContextValue => ({
  availability: {
    poster: { allowed: true, reason: null },
    "full-report": { allowed: true, reason: null },
  },
  state: { phase: "closed" },
  open: () => {
    if (value.state.phase === "closed") {
      value = { ...value, state: { phase: "idle" } };
      notify();
    }
  },
  generate: async (kind) => {
    if (value.state.phase === "closed" || value.state.phase === "rendering")
      return;
    const saved = cache.get(kind);
    if (saved) {
      value = { ...value, state: { phase: "ready", artifact: saved.artifact } };
      notify();
      return;
    }
    const token = epoch;
    value = { ...value, state: { phase: "rendering", kind } };
    notify();
    if (hold) {
      hold = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    if (token !== epoch) return;
    if (fail) {
      const code = fail;
      fail = null;
      value = { ...value, state: { phase: "error", kind, code } };
      notify();
      return;
    }
    const image = await createImageBitmap(
      await (
        await fetch(
          fixture.bindings.find((b) => b.slot === "character.reveal")!.url,
        )
      ).blob(),
    );
    const width = kind === "poster" ? 941 : 724,
      height = kind === "poster" ? 1672 : 3600,
      canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f6ead2";
    ctx.fillRect(0, 0, width, height);
    const scale = Math.max(
      width / image.width,
      Math.min(height * 0.65, 1200) / image.height,
    );
    ctx.drawImage(
      image,
      (width - image.width * scale) / 2,
      0,
      image.width * scale,
      image.height * scale,
    );
    image.close();
    ctx.fillStyle = "#102637";
    ctx.fillRect(0, height * 0.62, width, height * 0.38);
    ctx.fillStyle = "#f7dfb3";
    ctx.font = "600 44px system-ui";
    ctx.fillText("合成 UI 夹具 · 37 / 100", 40, height * 0.7);
    ctx.font = "32px system-ui";
    ctx.fillText("仅验证预览交互，不是正式报告图片", 40, height * 0.75);
    ctx.fillText("23 · 74 · 51 · 80 · 37", 40, height * 0.8);
    ctx.fillText("UI FIXTURE · END", 40, height - 80);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    canvas.width = 0;
    canvas.height = 0;
    if (token !== epoch) return;
    const artifact: QianzaiExportArtifact = {
      kind,
      previewUrl: URL.createObjectURL(blob) as `blob:${string}`,
      width,
      height,
      bytes: blob.size,
      fileName: `ui-synthetic-${kind}.png`,
    };
    cache.set(kind, { artifact, blob });
    renders[kind]++;
    value = { ...value, state: { phase: "ready", artifact } };
    notify();
  },
  close,
  download: () => {
    if (value.state.phase !== "ready") return false;
    actions.download++;
    const a = document.createElement("a");
    a.href = value.state.artifact.previewUrl;
    a.download = value.state.artifact.fileName;
    document.body.append(a);
    a.click();
    a.remove();
    return true;
  },
  share: async () => {
    actions.share++;
    return outcome;
  },
});
let value = valueStart();
Object.assign(window, {
  qztxExportFixture: {
    holdNext: () => {
      hold = true;
    },
    release: () => release?.(),
    failNext: (code: QianzaiExportErrorCode) => {
      fail = code;
    },
    shareOutcome: (next: QianzaiShareOutcome) => {
      outcome = next;
    },
    block: (kind: QianzaiExportKind, reason: QianzaiExportErrorCode) => {
      value = {
        ...value,
        availability: {
          ...value.availability,
          [kind]: { allowed: false, reason },
        },
      };
      notify();
    },
    revoke: () => {
      close();
      value = {
        ...value,
        availability: {
          poster: { allowed: false, reason: "AUTHORITY_LOST" },
          "full-report": { allowed: false, reason: "AUTHORITY_LOST" },
        },
      };
      notify();
    },
    snapshot: () => ({
      state: value.state,
      renders: { ...renders },
      actions: { ...actions },
      cache: [...cache.values()].map((c) => c.artifact),
    }),
    hash: async (kind: QianzaiExportKind) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            await cache.get(kind)!.blob.arrayBuffer(),
          ),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join(""),
  },
});
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useQianzaiExport = () =>
  useSyncExternalStore(
    subscribe,
    () => value,
    () => value,
  );
