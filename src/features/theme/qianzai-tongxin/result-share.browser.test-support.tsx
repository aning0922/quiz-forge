import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import { QianzaiTongxinExperience } from "./experience";
import { QianzaiResourceOwner, type QianzaiOwnedImage } from "./resource-owner";
import type { QianzaiResolvedImage } from "./art";

const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as {
  report: ConsumerV2ReaderModel;
  reveal: ConsumerV2ReaderModel;
  disclosure?: boolean;
  bindings: {
    asset: QianzaiResolvedImage["asset"];
    slot: "character.report" | "character.reveal" | "reportPaper";
    url: string;
    layer: "clean";
  }[];
};
function Runtime() {
  const reveal = new URLSearchParams(location.search).has("reveal-reference");
  const [model, setModel] = useState(reveal ? fixture.reveal : fixture.report),
    [images, setImages] = useState<readonly QianzaiOwnedImage[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    const owner = new QianzaiResourceOwner({
      generation: 0,
      model,
      view: model.report!.view,
      signal: abort.signal,
      current: () => !abort.signal.aborted && model.phase === "completed",
      getSnapshot: () => model,
      transport: (asset, signal) => {
        const binding = fixture.bindings.find(
          (b) => b.asset.resourceRef.id === asset.resourceRef.id,
        );
        if (!binding) throw Error("UNSCOPED_UI_REFERENCE");
        return fetch(binding.url, { signal });
      },
    });
    const unsub = owner.subscribe(() => setImages(owner.getSnapshot()));
    void owner.load(
      fixture.bindings.map(({ asset, slot, layer }) => ({
        asset,
        slot,
        layer,
      })),
    );
    Object.assign(window, {
      qztxResultProbe: {
        revoke: () => setModel((old) => ({ ...old, phase: "denied" })),
      },
    });
    return () => {
      abort.abort();
      unsub();
      owner.dispose();
    };
  }, [model]);
  return (
    <>
      {fixture.disclosure && (
        <aside
          style={{
            position: "fixed",
            top: 114,
            left: 12,
            right: 12,
            zIndex: 90,
            pointerEvents: "none",
            font: "12px/1.4 system-ui",
            color: "#fff4d6",
            textShadow: "0 1px 4px #000",
            background: "#102637b8",
            padding: "3px 7px",
            borderRadius: 5,
          }}
        >
          私有参考预览 · 合成分数 · 人物资源未正式准入
        </aside>
      )}
      <QianzaiTongxinExperience
        model={model}
        {...(!reveal ? { initialScreen: "report" as const } : {})}
        images={images.filter(
          (i): i is typeof i & { layer: "clean" } => i.layer === "clean",
        )}
        onEvent={() => {
          throw Error("READ_ONLY_UI_PROBE_MUTATION");
        }}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Runtime />);
