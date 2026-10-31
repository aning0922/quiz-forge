"use client";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import type { ConsumerResourceLeaseV2 } from "../consumer-v2/resource-port";
import type { QianzaiExportContextValue } from "@/features/report/qianzai-tongxin/contracts";
import { QianzaiExportOwner } from "./export-owner";
import { QIANZAI_RUNTIME_INPUTS } from "./runtime-inputs";
import type { QianzaiPresentationBinding } from "@/features/report/qianzai-tongxin/result-presentation";
export type {
  QianzaiExportKind,
  QianzaiExportErrorCode,
  QianzaiExportArtifact,
  QianzaiExportState,
  QianzaiExportAvailability,
  QianzaiShareOutcome,
  QianzaiExportContextValue,
} from "@/features/report/qianzai-tongxin/contracts";
const closed = Object.freeze({ phase: "closed" as const });
const unavailable = Object.freeze({
  allowed: false,
  reason: "CAPABILITY_UNAVAILABLE" as const,
});
const fallback: QianzaiExportContextValue = {
  availability: { poster: unavailable, "full-report": unavailable },
  state: closed,
  getCachedArtifact: () => null,
  getResultPresentation: () => null,
  getFailure: () => null,
  async prepare() {},
  open() {},
  async generate() {},
  close() {},
  download: () => false,
  share: async () => "unavailable",
};
const Context = createContext<QianzaiExportContextValue>(fallback);
const subscribeNothing = () => () => {};
const snapshotClosed = () => closed;
export function QianzaiExportProvider({
  model,
  lease,
  children,
  presentationBinding,
}: {
  model: ConsumerV2ReaderModel;
  lease: ConsumerResourceLeaseV2 | null;
  children?: ReactNode;
  presentationBinding?: QianzaiPresentationBinding;
}) {
  const profileVersion = presentationBinding?.profileVersion,
    kind = presentationBinding?.renderer.kind,
    id = presentationBinding?.renderer.id,
    version = presentationBinding?.renderer.version,
    entrySha256 = presentationBinding?.renderer.entrySha256;
  const stableBinding = useMemo<QianzaiPresentationBinding | undefined>(
    () =>
      profileVersion && kind && id && version && entrySha256
        ? Object.freeze({
            profileVersion,
            renderer: Object.freeze({ kind, id, version, entrySha256 }),
          })
        : undefined,
    [profileVersion, kind, id, version, entrySha256],
  );
  const owner = useMemo(
    () =>
      lease
        ? new QianzaiExportOwner(
            lease,
            QIANZAI_RUNTIME_INPUTS.resources,
            QIANZAI_RUNTIME_INPUTS.font,
            undefined,
            stableBinding,
          )
        : null,
    [lease, stableBinding],
  );
  const state = useSyncExternalStore(
    owner?.subscribe ?? subscribeNothing,
    owner?.getSnapshot ?? snapshotClosed,
    snapshotClosed,
  );
  useLayoutEffect(() => {
    owner?.activate();
    return () => owner?.dispose();
  }, [owner]);
  useLayoutEffect(() => {
    owner?.reconcile();
  }, [owner, model]);
  const viewMatches =
    model.phase === "completed" &&
    model.pendingOperation === null &&
    model.report?.view === lease?.view;
  const value: QianzaiExportContextValue =
    owner && viewMatches && owner.isCurrent()
      ? {
          availability: {
            poster: owner.availability("poster"),
            "full-report": owner.availability("full-report"),
          },
          state,
          getCachedArtifact: owner.getCachedArtifact,
          getResultPresentation: owner.getResultPresentation,
          getFailure: owner.getFailure,
          prepare: owner.prepare,
          open: owner.open,
          generate: owner.generate,
          close: owner.close,
          download: owner.download,
          share: owner.share,
        }
      : fallback;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useQianzaiExport = (): QianzaiExportContextValue =>
  useContext(Context);
