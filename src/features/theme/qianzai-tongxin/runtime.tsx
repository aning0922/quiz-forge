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
import { loadQianzaiFont } from "./font-owner";
import { QianzaiExportProvider } from "./export-context";

/** Resource changes never construct a controller, mutate pending or submit business operations. */
export function QianzaiTongxinRuntime(props: ConsumerExperiencePropsV2) {
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
    void loadQianzaiFont(QIANZAI_RUNTIME_INPUTS.font, lease)
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
      } => v.layer !== "clean",
    ),
  };
  return (
    <>
      {(
        props.model.report?.view.display.assets ??
        props.model.entry?.assets ??
        []
      ).some((a) => a.approval === "private-test-only") && (
        <p
          role="note"
          style={{
            position: "fixed",
            zIndex: 100,
            top: 8,
            left: 12,
            right: 12,
            margin: 0,
            textAlign: "center",
            fontSize: 16,
            color: "#f6ead2",
            background: "#153745dd",
            borderRadius: 8,
            padding: "5px 8px",
            pointerEvents: "none",
          }}
        >
          本机测试 · 参考素材／候选正文
        </p>
      )}
      {lease && (font.lease !== lease || !font.ready) && (
        <p role="status">固定字体尚未就绪，当前文字使用备用字体。</p>
      )}
      <QianzaiExportProvider model={props.model} lease={lease}>
        <QianzaiTongxinExperience
          key={`${lease?.generation ?? "none"}:${lease?.current() ? "active" : "revoked"}`}
          {...props}
          {...visual}
        />
      </QianzaiExportProvider>
    </>
  );
}
