"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ConsumerExperiencePropsV2 } from "@/features/theme/consumer-v2/interfaces";
import { useConsumerResourcePortV2 } from "@/features/theme/consumer-v2/resource-port";
import type { QianzaiPresentationBinding } from "@/features/report/qianzai-tongxin/historical-v13/result-presentation";
import { QIANZAI_RUNTIME_INPUTS } from "./runtime-inputs";
import { QIANZAI_EDITORIAL_FONTS } from "./editorial-fonts";
import {
  admittedQianzaiBindings,
  QianzaiResourceOwner,
  type QianzaiOwnedImage,
} from "./resource-owner";
import { loadQianzaiFonts } from "./font-owner";
import { QianzaiExportProvider } from "./export-context";
import { QianzaiReport } from "./report";
import typography from "./typography.module.css";

/** Report-only adapter. No quiz component, scoring, save or complete port is installed. */
export function QianzaiHistoricalRuntime(
  props: ConsumerExperiencePropsV2 & {
    presentationBinding: QianzaiPresentationBinding;
  },
) {
  const router = useRouter();
  const port = useConsumerResourcePortV2();
  const view = props.model.report?.view;
  const allowed =
    props.model.phase === "completed" && props.model.pendingOperation === null;
  const lease = useMemo(
    () => (allowed && view ? (port?.capture(view) ?? null) : null),
    [allowed, port, view],
  );
  const [loaded, setLoaded] = useState<{
    lease: typeof lease;
    images: readonly QianzaiOwnedImage[];
  }>({ lease: null, images: [] });
  const [fonts, setFonts] = useState<{ lease: typeof lease; ready: boolean }>({
    lease: null,
    ready: false,
  });
  useEffect(() => {
    if (!lease) return;
    const owner = new QianzaiResourceOwner(lease);
    const update = () => setLoaded({ lease, images: owner.getSnapshot() });
    const stop = owner.subscribe(update);
    void owner.load(
      admittedQianzaiBindings(lease.model, QIANZAI_RUNTIME_INPUTS.resources),
    );
    return () => {
      stop();
      owner.dispose();
    };
  }, [lease]);
  useEffect(() => {
    if (!lease || !QIANZAI_RUNTIME_INPUTS.font) return;
    let live = true,
      release: (() => void) | undefined;
    const task = new AbortController();
    void loadQianzaiFonts(
      [QIANZAI_RUNTIME_INPUTS.font, ...Object.values(QIANZAI_EDITORIAL_FONTS)],
      lease,
      task.signal,
    )
      .then((owned) => {
        if (!live || !lease.current()) {
          owned.release();
          return;
        }
        release = owned.release;
        setFonts({ lease, ready: true });
      })
      .catch(() => {
        if (live && lease.current()) setFonts({ lease, ready: false });
      });
    return () => {
      live = false;
      task.abort();
      release?.();
    };
  }, [lease]);
  const images =
    loaded.lease === lease && lease?.current()
      ? loaded.images.filter(
          (v): v is QianzaiOwnedImage & { layer: "clean" } =>
            v.layer === "clean",
        )
      : [];
  if (!allowed || !view) return null;
  return (
    <div className={typography.root} data-qianzai-historical="v13">
      {lease && (fonts.lease !== lease || !fonts.ready) && (
        <p role="status" className={typography.fontStatus}>
          画卷文字尚未准备完成，暂用备用字体显示。
        </p>
      )}
      <QianzaiExportProvider
        model={props.model}
        lease={lease}
        presentationBinding={props.presentationBinding}
      >
        <QianzaiReport
          model={props.model}
          images={images}
          onRead={() => router.push("/access")}
          onEvent={(event) => {
            if (event.type === "logout") props.onEvent(event);
          }}
        />
      </QianzaiExportProvider>
    </div>
  );
}
