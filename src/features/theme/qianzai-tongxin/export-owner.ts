import type { ConsumerResourceLeaseV2 } from "../consumer-v2/resource-port";
import type { QianzaiAssetBinding } from "./resource-owner";
import { admittedQianzaiBindings } from "./resource-owner";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { sameArtRef } from "./art";
import {
  QIANZAI_COMPONENT_MAPPING,
  QIANZAI_CONSUMER_RENDERER,
} from "./component-map";
import type { QIANZAI_RUNTIME_INPUTS } from "./runtime-inputs";
import {
  renderQianzaiExport,
  qianzaiExportFailure,
} from "@/features/report/qianzai-tongxin/export";
import {
  QIANZAI_EXPORT_LIMITS as L,
  QianzaiExportError,
  type QianzaiExportKind,
  type QianzaiExportState,
  type QianzaiExportScope,
  type QianzaiExportArtifact,
  type QianzaiExportAvailability,
  type QianzaiShareOutcome,
} from "@/features/report/qianzai-tongxin/contracts";

/** The shared port supplies this read-only getter from the actual controller, not React timing. */
export type QianzaiExportLease = ConsumerResourceLeaseV2;
type Font = NonNullable<typeof QIANZAI_RUNTIME_INPUTS.font>;
type Cached = { blob: Blob; artifact: QianzaiExportArtifact };
type Render = typeof renderQianzaiExport;
const unavailable = (
  reason: QianzaiExportAvailability["reason"],
): QianzaiExportAvailability => ({ allowed: false, reason });

export class QianzaiExportOwner {
  private state: QianzaiExportState = { phase: "closed" };
  private listeners = new Set<() => void>();
  private cache = new Map<QianzaiExportKind, Cached>();
  private epoch = 0;
  private active: AbortController | null = null;
  private disposed = false;
  private readonly report;
  private readonly receipt;
  private readonly renderer;
  private readonly parent;
  private readonly body;
  private readonly abort = () => this.close();
  constructor(
    private readonly lease: QianzaiExportLease,
    private readonly bindings: readonly QianzaiAssetBinding[],
    private readonly font: Font | null,
    private readonly render: Render = renderQianzaiExport,
  ) {
    this.report = lease.model.report;
    this.receipt = this.report ? JSON.stringify(this.report.receipt) : "";
    this.renderer = this.report
      ? JSON.stringify(this.report.view.renderer)
      : "";
    this.parent = this.report ? JSON.stringify(this.report.view.parent) : "";
    this.body = this.report?.view.display.body;
  }
  activate = () => {
    this.disposed = false;
    this.lease.signal.addEventListener("abort", this.abort, { once: true });
    if (this.lease.signal.aborted) this.close();
  };
  getSnapshot = (): QianzaiExportState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(state: QianzaiExportState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private latest() {
    if (this.disposed || this.lease.signal.aborted || !this.lease.current())
      throw new QianzaiExportError("AUTHORITY_LOST");
    const model = this.lease.getSnapshot(),
      report = model.report;
    if (
      model.phase !== "completed" ||
      model.pendingOperation !== null ||
      !report
    )
      throw new QianzaiExportError("NOT_COMPLETED");
    if (
      !this.report ||
      report.view !== this.lease.view ||
      report.view !== this.report.view ||
      report.view.display.body !== this.body ||
      JSON.stringify(report.receipt) !== this.receipt ||
      JSON.stringify(report.view.parent) !== this.parent ||
      JSON.stringify(report.view.renderer) !== this.renderer
    )
      throw new QianzaiExportError("AUTHORITY_LOST");
    const d = report.view.display,
      r = report.view.renderer;
    if (
      r.id !== QIANZAI_CONSUMER_RENDERER.id ||
      r.version !== QIANZAI_CONSUMER_RENDERER.version ||
      d.presentationMode !== "authored-product" ||
      !sameConsumerFact(report.view.mapping, QIANZAI_COMPONENT_MAPPING, 8192)
    )
      throw new QianzaiExportError("CAPABILITY_UNAVAILABLE");
    if (
      !this.font ||
      "kind" in report.view.font ||
      !sameConsumerFact(
        report.view.font,
        {
          id: this.font.id,
          version: this.font.version,
          fileSha256: this.font.fileSha256,
          coverageSha256: this.font.coverageSha256,
          licenseSha256: this.font.licenseSha256,
          weight: this.font.weight,
        },
        8192,
      )
    )
      throw new QianzaiExportError("FONT_UNAVAILABLE");
    return model;
  }
  private scope(
    kind: QianzaiExportKind,
    current: () => boolean,
  ): QianzaiExportScope {
    const model = this.latest(),
      display = model.report!.view.display;
    if (
      !(kind === "poster"
        ? display.exports.posterPng
        : display.exports.fullReportPng)
    )
      throw new QianzaiExportError("CAPABILITY_UNAVAILABLE");
    const character = display.slots.character;
    if (!sameArtRef(character.resultRef, display.selectedResultRef))
      throw new QianzaiExportError("ARTWORK_UNAVAILABLE");
    const allowed = admittedQianzaiBindings(model, this.bindings);
    const image = (slot: string, ref: typeof character.reveal) =>
      allowed.find(
        (a) =>
          a.slot === slot &&
          a.layer === "clean" &&
          sameArtRef(a.asset.resourceRef, ref),
      )?.asset;
    const portrait = image(
      `character.${kind === "poster" ? "poster" : "report"}`,
      kind === "poster" ? character.poster : character.report,
    );
    const nameArt = image("character.nameArt", character.nameArt);
    if (
      !portrait ||
      !nameArt ||
      portrait.purpose !== "portrait" ||
      nameArt.purpose !== "decoration"
    )
      throw new QianzaiExportError("ARTWORK_UNAVAILABLE");
    return {
      body: display.body,
      portrait,
      nameArt,
      paper: image("reportPaper", display.slots.neutral.reportPaper) ?? null,
      font: {
        ...this.font!,
        file: fixedFontPath(this.font!.file),
        coverage: fixedFontPath(this.font!.coverage),
        licenseFile: fixedFontPath(this.font!.licenseFile),
      },
      transport: this.lease.transport,
      current,
    };
  }
  availability = (kind: QianzaiExportKind): QianzaiExportAvailability => {
    try {
      this.scope(kind, () => this.isCurrent());
      return { allowed: true, reason: null };
    } catch (error) {
      return unavailable(qianzaiExportFailure(error).code);
    }
  };
  isCurrent = () => {
    try {
      this.latest();
      return true;
    } catch {
      return false;
    }
  };
  /** React commits call this as well; every async/action checkpoint independently reads the getter. */
  reconcile = () => {
    if (
      !this.isCurrent() &&
      (this.cache.size || this.active || this.state.phase !== "closed")
    )
      this.close();
  };
  open = () => {
    if (
      this.availability("poster").allowed ||
      this.availability("full-report").allowed
    ) {
      if (this.state.phase === "closed") this.set({ phase: "idle" });
    }
  };
  close = () => {
    this.epoch++;
    const active = this.active;
    this.active = null;
    active?.abort();
    for (const item of this.cache.values())
      URL.revokeObjectURL(item.artifact.previewUrl);
    this.cache.clear();
    if (this.state.phase !== "closed") this.set({ phase: "closed" });
  };
  dispose = () => {
    this.close();
    this.disposed = true;
    this.lease.signal.removeEventListener("abort", this.abort);
    this.listeners.clear();
  };
  generate = async (kind: QianzaiExportKind): Promise<void> => {
    if (
      (kind !== "poster" && kind !== "full-report") ||
      this.state.phase === "closed" ||
      this.disposed ||
      this.active
    )
      return;
    const epoch = this.epoch,
      task = new AbortController();
    const current = () =>
      this.active === task &&
      this.epoch === epoch &&
      !task.signal.aborted &&
      this.isCurrent();
    try {
      this.active = task;
      const scope = this.scope(kind, current);
      const cached = this.cache.get(kind);
      if (cached) {
        if (!current()) throw new QianzaiExportError("AUTHORITY_LOST");
        this.set({ phase: "ready", artifact: cached.artifact });
        return;
      }
      this.set({ phase: "rendering", kind });
      const output = await this.render(kind, scope, task.signal);
      if (!current()) throw new QianzaiExportError("AUTHORITY_LOST");
      if (
        output.blob.type !== "image/png" ||
        !output.blob.size ||
        output.blob.size > L.maxPngBytes ||
        output.width !== (kind === "poster" ? L.posterWidth : L.reportWidth) ||
        !Number.isSafeInteger(output.height) ||
        output.height < 1 ||
        output.height > L.maxHeight ||
        output.width * output.height > L.maxCanvasPixels ||
        (kind === "poster" && output.height !== L.posterHeight)
      )
        throw new QianzaiExportError("CONTENT_LIMIT");
      const previewUrl = URL.createObjectURL(output.blob) as `blob:${string}`;
      if (!current()) {
        URL.revokeObjectURL(previewUrl);
        throw new QianzaiExportError("AUTHORITY_LOST");
      }
      const artifact: QianzaiExportArtifact = Object.freeze({
        kind,
        previewUrl,
        width: output.width,
        height: output.height,
        bytes: output.blob.size,
        fileName:
          kind === "poster"
            ? "qianzai-tongxin-poster.png"
            : "qianzai-tongxin-full-report.png",
      });
      this.cache.set(kind, { blob: output.blob, artifact });
      this.set({ phase: "ready", artifact });
    } catch (error) {
      if (this.epoch !== epoch || task.signal.aborted || this.disposed) return;
      if (!this.isCurrent()) {
        this.close();
        return;
      }
      this.set({
        phase: "error",
        kind,
        code: qianzaiExportFailure(error).code,
      });
    } finally {
      if (this.active === task) this.active = null;
      task.abort();
    }
  };
  private selected() {
    if (this.state.phase !== "ready") return null;
    if (!this.availability(this.state.artifact.kind).allowed) {
      this.close();
      return null;
    }
    return this.cache.get(this.state.artifact.kind) ?? null;
  }
  download = (): boolean => {
    const item = this.selected();
    if (!item) return false;
    const a = document.createElement("a");
    a.href = item.artifact.previewUrl;
    a.download = item.artifact.fileName;
    a.style.display = "none";
    try {
      if (!this.selected()) return false;
      document.body.append(a);
      if (!this.selected()) return false;
      a.click();
      return true;
    } finally {
      a.remove();
    }
  };
  share = async (): Promise<QianzaiShareOutcome> => {
    const item = this.selected();
    if (!item) return "unavailable";
    const epoch = this.epoch;
    try {
      const file = new File([item.blob], item.artifact.fileName, {
        type: "image/png",
      });
      if (
        !navigator.share ||
        (navigator.canShare && !navigator.canShare({ files: [file] }))
      )
        return "download-required";
      if (!this.selected() || epoch !== this.epoch) return "unavailable";
      await navigator.share({ files: [file], title: "千载同心" });
      return this.selected() && epoch === this.epoch ? "shared" : "unavailable";
    } catch (error) {
      return error instanceof Error && error.name === "AbortError"
        ? "cancelled"
        : "failed";
    }
  };
}

function fixedFontPath(path: string): `/assets/fonts/${string}` {
  if (!/^\/assets\/fonts\/[A-Za-z0-9_/-]+\.(woff2|txt)$/.test(path))
    throw new QianzaiExportError("FONT_UNAVAILABLE");
  return path as `/assets/fonts/${string}`;
}
