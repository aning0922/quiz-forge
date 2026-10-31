/** Original embedded PNG preview port, aliased only by the reference harness.
 * It never calls a renderer, scorer, snapshot service or external share API. */
import { useSyncExternalStore } from "react";
import type {
  QianzaiExportContextValue,
  QianzaiExportKind,
  QianzaiExportArtifact,
} from "@/features/report/qianzai-tongxin/contracts";
type OriginalImage = {
  url: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
};
const input = JSON.parse(document.getElementById("fixture")!.textContent!) as {
  mode: "reference-only";
  share: { poster: OriginalImage; long: OriginalImage };
};
if (input.mode !== "reference-only")
  throw Error("REFERENCE_ONLY_PORT_REQUIRED");
const listeners = new Set<() => void>(),
  cache = new Map<QianzaiExportKind, QianzaiExportArtifact>();
let epoch = 0,
  active: AbortController | null = null;
const notify = () => {
  api = { ...api };
  listeners.forEach((listener) => listener());
};
const setState = (state: QianzaiExportContextValue["state"]) => {
  api = { ...api, state };
  notify();
};
const close = () => {
  epoch++;
  active?.abort();
  active = null;
  cache.forEach((artifact) => URL.revokeObjectURL(artifact.previewUrl));
  cache.clear();
  setState({ phase: "closed" });
};
const generate = async (kind: QianzaiExportKind) => {
  if (api.state.phase === "closed" || active) return;
  const cached = cache.get(kind);
  if (cached) {
    setState({ phase: "ready", artifact: cached });
    return;
  }
  const generation = epoch,
    task = new AbortController(),
    source = input.share[kind === "poster" ? "poster" : "long"];
  let previewUrl: `blob:${string}` | undefined;
  active = task;
  setState({ phase: "rendering", kind });
  try {
    if (!/^\/raw\/[a-f0-9]{64}$/.test(source.url))
      throw Error("UNSCOPED_REFERENCE_IMAGE");
    const response = await fetch(source.url, { signal: task.signal });
    if (!response.ok) throw Error("REFERENCE_IMAGE_UNAVAILABLE");
    const blob = await response.blob(),
      sha256 = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
        ),
        (value) => value.toString(16).padStart(2, "0"),
      ).join("");
    if (sha256 !== source.sha256 || blob.size !== source.bytes)
      throw Error("REFERENCE_BYTES_CHANGED");
    previewUrl = URL.createObjectURL(blob) as `blob:${string}`;
    const image = new Image();
    image.src = previewUrl;
    await image.decode();
    if (
      image.naturalWidth !== source.width ||
      image.naturalHeight !== source.height
    )
      throw Error("REFERENCE_DIMENSIONS_CHANGED");
    if (generation !== epoch || task.signal.aborted) return;
    const artifact: QianzaiExportArtifact = {
      kind,
      previewUrl,
      width: source.width,
      height: source.height,
      bytes: blob.size,
      fileName: `REFERENCE-ONLY-${kind}.png`,
    };
    cache.set(kind, artifact);
    previewUrl = undefined;
    setState({ phase: "ready", artifact });
  } catch {
    if (generation === epoch && !task.signal.aborted) {
      setState({ phase: "error", kind, code: "RESOURCE_UNAVAILABLE" });
    }
  } finally {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (active === task) active = null;
  }
};
let api: QianzaiExportContextValue = {
  availability: {
    poster: { allowed: true, reason: null },
    "full-report": { allowed: true, reason: null },
  },
  state: { phase: "closed" },
  getCachedArtifact: (kind) => cache.get(kind) ?? null,
  open: () => {
    if (api.state.phase === "closed") {
      setState({ phase: "idle" });
    }
  },
  close,
  generate,
  download: () => {
    if (api.state.phase !== "ready") return false;
    const anchor = document.createElement("a");
    anchor.href = api.state.artifact.previewUrl;
    anchor.download = api.state.artifact.fileName;
    anchor.click();
    return true;
  },
  share: async () => "download-required",
};
export const useQianzaiExport = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => api,
    () => api,
  );
