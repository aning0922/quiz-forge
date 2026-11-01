"use client";
import { useEffect, useMemo, useState } from "react";
import type { ConsumerExperiencePropsV2 } from "../consumer-v2/interfaces";
import { useConsumerResourcePortV2 } from "../consumer-v2/resource-port";
import { QianzaiTongxinExperience } from "./experience";
import { QIANZAI_RUNTIME_INPUTS } from "./runtime-inputs";
import {
  admittedQianzaiBindings,
  QianzaiResourceOwner,
  type QianzaiOwnedImage,
} from "./resource-owner";
import { loadQianzaiFonts } from "./font-owner";
import { QIANZAI_EDITORIAL_FONTS } from "./editorial-fonts";
import typography from "./typography.module.css";
import { QianzaiExportProvider } from "./export-context";
import type { QianzaiPresentationBinding } from "@/features/report/qianzai-tongxin/result-presentation";

/** Resource changes never construct a controller, mutate pending or submit business operations. */
export function QianzaiTongxinRuntime(
  props: ConsumerExperiencePropsV2 & {
    presentationBinding?: QianzaiPresentationBinding;
  },
) {
  const port = useConsumerResourcePortV2();
  const view = props.model.report?.view ?? props.model.entry;
  const denied = props.model.phase === "denied";
  const lease = useMemo(
    () => (denied || !view ? null : (port?.capture(view) ?? null)),
    [port, view, denied],
  );
  const [loaded, setLoaded] = useState<{
    lease: typeof lease;
    images: readonly QianzaiOwnedImage[];
  }>({ lease: null, images: [] });
  const [font, setFont] = useState<{ lease: typeof lease; ready: boolean }>({
    lease: null,
    ready: false,
  });
  useEffect(() => {
    if (!lease) return;
    const owner = new QianzaiResourceOwner(lease);
    const update = () => setLoaded({ lease, images: owner.getSnapshot() });
    const unsubscribe = owner.subscribe(update);
    void owner.load(
      admittedQianzaiBindings(lease.model, QIANZAI_RUNTIME_INPUTS.resources),
    );
    return () => {
      unsubscribe();
      owner.dispose();
    };
  }, [lease]);
  useEffect(() => {
    if (!lease || !QIANZAI_RUNTIME_INPUTS.font) return;
    let active = true,
      release: (() => void) | undefined;
    void loadQianzaiFonts(
      [QIANZAI_RUNTIME_INPUTS.font, ...Object.values(QIANZAI_EDITORIAL_FONTS)],
      lease,
    )
      .then((owned) => {
        if (!active || !lease.current()) {
          owned.release();
          return;
        }
        release = owned.release;
        setFont({ lease, ready: true });
      })
      .catch(() => {
        if (active && lease.current()) setFont({ lease, ready: false });
      });
    return () => {
      active = false;
      release?.();
    };
  }, [lease]);
  const images =
    loaded.lease === lease && lease?.current() ? loaded.images : [];
  const visual = {
    images: images.filter(
      (v): v is QianzaiOwnedImage & { layer: "clean" } => v.layer === "clean",
    ),
    prototypeImages: images.filter(
      (
        v,
      ): v is QianzaiOwnedImage & {
        layer: "prototype-scene-base" | "prototype-option-skin";
      } =>
        v.layer === "prototype-scene-base" ||
        v.layer === "prototype-option-skin",
    ),
    roleCompositeImages: images.filter(
      (
        v,
      ): v is QianzaiOwnedImage & {
        layer: "role-composite";
        resultRef: NonNullable<QianzaiOwnedImage["resultRef"]>;
      } => v.layer === "role-composite" && !!v.resultRef,
    ),
  };
  return (
    <div className={typography.root}>
      {lease && (font.lease !== lease || !font.ready) && (
        <p role="status" className={typography.fontStatus}>
          画卷文字尚未准备完成，暂用备用字体显示。
        </p>
      )}
      <QianzaiExportProvider
        model={props.model}
        lease={lease}
        {...(props.presentationBinding
          ? { presentationBinding: props.presentationBinding }
          : {})}
      >
        <QianzaiTongxinExperience
          key={`${lease?.generation ?? "none"}:${lease?.current() ? "active" : "revoked"}`}
          {...props}
          {...visual}
        />
      </QianzaiExportProvider>
    </div>
  );
}
