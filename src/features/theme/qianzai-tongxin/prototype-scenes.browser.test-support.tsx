import { useEffect, useState } from "react";
import styles from "./qianzai.module.css";
import { createRoot } from "react-dom/client";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import type { QianzaiPrototypeImage, QianzaiResolvedImage } from "./art";
import {
  QianzaiCover,
  QianzaiPreference,
  QianzaiQuestion,
  QianzaiReveal,
  type QianzaiRevealReference,
} from "./views";

/** Reference-only props, not a consumer controller or a score/snapshot producer.
 * Every interaction stays in this component's local state. No business transport.
 */
const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as {
  model: ConsumerV2ReaderModel;
  completed: ConsumerV2ReaderModel;
  assets: {
    asset: QianzaiResolvedImage["asset"];
    url: string;
    layer: QianzaiResolvedImage["layer"] | QianzaiPrototypeImage["layer"];
  }[];
  before: { url: string; sha256: QianzaiRevealReference["before"]["sha256"] };
  full: { url: string; sha256: QianzaiRevealReference["full"]["sha256"] };
};
function ReferenceScenes() {
  const [model, setModel] = useState(fixture.model),
    [screen, setScreen] = useState(
      new URLSearchParams(location.search).get("screen") ?? "cover",
    ),
    [images, setImages] = useState<{
      clean: QianzaiResolvedImage[];
      prototype: QianzaiPrototypeImage[];
      reference: QianzaiRevealReference;
    } | null>(null);
  useEffect(() => {
    let live = true;
    const abort = new AbortController(),
      urls: string[] = [];
    const load = async (url: string, sha256: string) => {
      const response = await fetch(url, { signal: abort.signal }),
        blob = await response.blob();
      const sha = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (sha !== sha256) throw Error("REFERENCE_BYTES_CHANGED");
      const objectUrl = URL.createObjectURL(blob) as `blob:${string}`;
      urls.push(objectUrl);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      return objectUrl;
    };
    void (async () => {
      const loaded = await Promise.all(
          fixture.assets.map(async (item) => ({
            ...item,
            objectUrl: await load(item.url, item.asset.sha256),
          })),
        ),
        before = await load(fixture.before.url, fixture.before.sha256),
        full = await load(fixture.full.url, fixture.full.sha256);
      if (live)
        setImages({
          clean: loaded.filter(
            (v): v is typeof v & { layer: "clean" } => v.layer === "clean",
          ),
          prototype: loaded.filter(
            (v): v is typeof v & { layer: QianzaiPrototypeImage["layer"] } =>
              v.layer !== "clean",
          ),
          reference: {
            mode: "reference-only",
            before: { objectUrl: before, sha256: fixture.before.sha256 },
            full: { objectUrl: full, sha256: fixture.full.sha256 },
          },
        });
    })().catch((e) => {
      if (live) document.body.dataset.referenceError = String(e);
    });
    return () => {
      live = false;
      abort.abort();
      urls.forEach(URL.revokeObjectURL);
    };
  }, []);
  const [revealPhase, setRevealPhase] = useState<"ready" | "playing">("ready"),
    [startedAt, setStartedAt] = useState(0),
    [revealCycle, setRevealCycle] = useState(0);
  useEffect(() => {
    Object.assign(window, {
      qianzaiReference: {
        playReveal() {
          setRevealCycle((old) => old + 1);
          setStartedAt(performance.now());
          setRevealPhase("playing");
        },
      },
    });
    return () => {
      delete (window as Window & { qianzaiReference?: unknown })
        .qianzaiReference;
    };
  }, []);
  const change = (questionId: string, optionId: string) =>
    setModel((old) => {
      const answers = [
        ...old.draft!.answers.filter((a) => a.questionId !== questionId),
        { questionId, optionId },
      ];
      // Mirror only the original HTML's local reference-cache presentation.
      return {
        ...old,
        state: { ...old.state!, answers },
        draft: { ...old.draft!, answers },
      };
    });
  const visual = images
    ? { images: images.clean, prototypeImages: images.prototype }
    : {};
  return (
    <main
      className={styles.host}
      data-reference-only="true"
      data-reference-ready={!!images}
    >
      <details
        style={{
          font: "16px/24px system-ui",
          color: "#f5e6ca",
          background: "#14283b",
          padding: "4px 12px",
        }}
      >
        <summary>原型对照专用 · 非业务数据</summary>
        <p>
          此夹具的原型12题、李白和原图短句仅用于同内容视觉对照。操作仅在本页内存生效，不调用评分、保存、完成、报告快照或数据库。
        </p>
      </details>
      {screen === "cover" ? (
        <QianzaiCover
          model={model}
          {...visual}
          onEvent={() => {
            throw Error("REFERENCE_NO_BUSINESS_IO");
          }}
          onRead={setScreen}
          active
        />
      ) : screen === "preference" ? (
        <QianzaiPreference
          model={model}
          {...visual}
          onEvent={() => {
            throw Error("REFERENCE_NO_BUSINESS_IO");
          }}
          onRead={setScreen}
          onEnter={() => setScreen("question")}
          onChoose={(preference) =>
            setModel((old) => ({
              ...old,
              draft: {
                ...old.draft!,
                matchingContext: { ...old.draft!.matchingContext!, preference },
              },
            }))
          }
        />
      ) : screen === "result" ? (
        <QianzaiReveal
          key={revealCycle}
          model={fixture.completed}
          {...visual}
          {...(images ? { referenceComposite: images.reference } : {})}
          onEvent={() => {
            throw Error("REFERENCE_NO_BUSINESS_IO");
          }}
          onRead={() => {
            document.body.dataset.reportRequested = "true";
          }}
          presentation={revealPhase}
          startedAt={startedAt}
        />
      ) : (
        <QianzaiQuestion
          model={model}
          {...visual}
          onRead={setScreen}
          onEvent={(event) => {
            if (event.type !== "navigate")
              throw Error("REFERENCE_NO_BUSINESS_IO");
            setModel((old) => ({
              ...old,
              state: {
                ...old.state!,
                progress: { questionId: event.questionId },
              },
              draft: {
                ...old.draft!,
                progress: { questionId: event.questionId },
              },
            }));
          }}
          onChoose={change}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<ReferenceScenes />);
