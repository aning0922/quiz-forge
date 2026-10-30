import { createElement, StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  QianzaiExportProvider,
  useQianzaiExport,
  type QianzaiExportContextValue,
} from "@/features/theme/qianzai-tongxin/export-context";
import {
  QianzaiExportOwner,
  type QianzaiExportLease,
} from "@/features/theme/qianzai-tongxin/export-owner";
import type { qianzaiExportFixture } from "@/features/report/qianzai-tongxin/export.test-support";
import type { QianzaiExportKind } from "@/features/report/qianzai-tongxin/contracts";
const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as Awaited<ReturnType<typeof qianzaiExportFixture>>;
const nativeFetch = window.fetch.bind(window),
  nativeCreate = URL.createObjectURL.bind(URL),
  nativeRevoke = URL.revokeObjectURL.bind(URL);
const liveUrls = new Set<string>();
URL.createObjectURL = (blob) => {
  const url = nativeCreate(blob);
  liveUrls.add(url);
  return url;
};
URL.revokeObjectURL = (url) => {
  liveUrls.delete(url);
  nativeRevoke(url);
};
let mode = "normal",
  current = fixture.model;
window.fetch = (input, init) =>
  mode === "missing-font" && String(input).includes("/assets/fonts/")
    ? Promise.resolve(new Response(null, { status: 404 }))
    : nativeFetch(input, init);
function makeOwner() {
  const source = new AbortController();
  const lease: QianzaiExportLease = {
    view: current.report!.view,
    model: current,
    generation: 1,
    signal: source.signal,
    current: () => !source.signal.aborted,
    getSnapshot: () => current,
    transport: async (asset, signal) => {
      if (mode === "wrong-hash")
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": asset.mediaType },
        });
      return nativeFetch(`/asset/${asset.resourceRef.id}`, { signal });
    },
  };
  const owner = new QianzaiExportOwner(lease, fixture.bindings, fixture.font);
  owner.activate();
  return owner;
}
let owner = makeOwner();
const probe = {
  async generate(kind: QianzaiExportKind) {
    owner.open();
    await owner.generate(kind);
    const state = owner.getSnapshot();
    if (state.phase !== "ready")
      return {
        phase: state.phase,
        code: state.phase === "error" ? state.code : null,
        liveUrls: liveUrls.size,
      };
    const data = await nativeFetch(state.artifact.previewUrl).then((r) =>
      r.arrayBuffer(),
    );
    return {
      phase: "ready",
      artifact: state.artifact,
      bytes: Array.from(new Uint8Array(data)),
      liveUrls: liveUrls.size,
    };
  },
  reset(next: string) {
    owner.dispose();
    mode = next;
    current = structuredClone(fixture.model);
    if (next === "missing-glyph")
      current.report!.view.display.body.volumes[5]!.paragraphs[0]!.text =
        String.fromCodePoint(0x20000);
    owner = makeOwner();
  },
  async late() {
    owner.dispose();
    mode = "normal";
    current = structuredClone(fixture.model);
    owner = makeOwner();
    const original = HTMLCanvasElement.prototype.toBlob;
    let encoded!: () => void;
    const ready = new Promise<void>((resolve) => {
      encoded = resolve;
    });
    let publish!: () => void;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      original.call(
        this,
        (blob) => {
          publish = () => callback(blob);
          encoded();
        },
        ...args,
      );
    };
    try {
      owner.open();
      const task = owner.generate("poster");
      await ready;
      owner.close();
      publish();
      await task;
      return { phase: owner.getSnapshot().phase, liveUrls: liveUrls.size };
    } finally {
      HTMLCanvasElement.prototype.toBlob = original;
    }
  },
  async provider() {
    owner.dispose();
    mode = "normal";
    current = structuredClone(fixture.model);
    const source = new AbortController();
    const lease: QianzaiExportLease = {
      view: current.report!.view,
      model: current,
      generation: 2,
      signal: source.signal,
      current: () => !source.signal.aborted,
      getSnapshot: () => current,
      transport: (asset, signal) =>
        nativeFetch(`/asset/${asset.resourceRef.id}`, { signal }),
    };
    let api!: QianzaiExportContextValue;
    let notify: (() => void) | undefined;
    function Harness() {
      const context = useQianzaiExport();
      useLayoutEffect(() => {
        api = context;
        notify?.();
      }, [context]);
      return null;
    }
    const host = document.createElement("div"),
      root = createRoot(host);
    document.body.append(host);
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("PROVIDER_STATE_TIMEOUT")),
        5000,
      );
      notify = () => {
        if (api.state.phase === "error") {
          clearTimeout(timer);
          reject(Error(api.state.code));
        }
        if (api.state.phase === "ready") {
          clearTimeout(timer);
          resolve();
        }
      };
    });
    try {
      flushSync(() =>
        root.render(
          createElement(
            StrictMode,
            null,
            createElement(
              QianzaiExportProvider,
              { model: current, lease },
              createElement(Harness),
            ),
          ),
        ),
      );
      flushSync(() => api.open());
      await api.generate("poster");
      await ready;
      const generated = api.state.phase,
        urlsAfterGenerate = liveUrls.size;
      // Controller getter changes before React receives a new model prop.
      current = { ...current, pendingOperation: "complete" };
      const download = api.download();
      flushSync(() => api.close());
      return {
        generated,
        urlsAfterGenerate,
        downloadWhilePending: download,
        parentAborted: source.signal.aborted,
        liveUrls: liveUrls.size,
      };
    } finally {
      notify = undefined;
      flushSync(() => root.unmount());
      host.remove();
    }
  },
  close() {
    owner.close();
    return liveUrls.size;
  },
};
(window as unknown as { qianzaiExportProbe: typeof probe }).qianzaiExportProbe =
  probe;
