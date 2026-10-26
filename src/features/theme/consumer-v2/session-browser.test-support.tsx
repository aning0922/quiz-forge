import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConsumerControllerV2 } from "./controller";
import {
  ConsumerSessionRuntimeV2,
  type ConsumerExperienceRuntimeV2,
} from "./experience";
import { ConsumerExperienceV2 } from "./host";
import { CurrentConsumerSession } from "../consumer-current/session";
import {
  consumerSaveBindingSha256V2,
  type ConsumerSaveInputV2,
} from "@/lib/consumer-contract/v2/state";
import type { consumerSessionFixtureV2 } from "./session.test-support";
import type { consumerHostFixtureV1 } from "../consumer-v1/host.test-support";

const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as {
  v2: Awaited<ReturnType<typeof consumerSessionFixtureV2>>;
  v1: Awaited<ReturnType<typeof consumerHostFixtureV1>>;
};
type Mode =
  "editable" | "report" | "legacy" | "invalid" | "late" | "unsupported";
const calls: { path: string; method: string }[] = [],
  owners: ConsumerControllerV2[] = [];
let mode: Mode = "editable",
  dropNextSave = false,
  release: (() => void) | undefined;
let currentState = fixture.v2.initial,
  savedLost: ConsumerSaveInputV2 | undefined;
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
async function applied(input: ConsumerSaveInputV2) {
  const bindingSha256 = await consumerSaveBindingSha256V2(input.binding);
  currentState = {
    ...currentState,
    stateRevision: input.binding.expectedStateRevision + 1,
    answers: input.answers,
    progress: input.progress,
    matchingContext: input.matchingContext,
    consumerStateAnswersSha256: input.binding.consumerStateAnswersSha256,
    progressSha256: input.binding.progressSha256,
    matchingContextSha256: input.binding.matchingContextSha256,
    lastSave: {
      schemaVersion: "quizforge.consumer-save-receipt.v2",
      binding: input.binding,
      bindingSha256,
      appliedStateRevision: input.binding.expectedStateRevision + 1,
      savedAt: fixture.v2.view.observedAt,
    },
  };
  return {
    schemaVersion: "quizforge.consumer-save-resolution.v2",
    kind: "applied-current",
    binding: input.binding,
    bindingSha256,
    state: currentState,
  };
}
const fetcher: typeof fetch = async (url, options) => {
  const path = String(url),
    method = options?.method ?? "GET";
  calls.push({ path, method });
  if (path.endsWith("session")) {
    if (mode === "late")
      await new Promise<void>((r) => {
        release = r;
      });
    if (mode === "legacy") return response(fixture.v1.view);
    if (mode === "report") return response(fixture.v2.completedView);
    if (mode === "invalid")
      return response({
        ...fixture.v2.view,
        outcome: {
          kind: "editable",
          state: {
            ...fixture.v2.initial,
            matchingContextSha256: "0".repeat(64),
          },
        },
      });
    return response({
      ...fixture.v2.view,
      outcome: { kind: "editable", state: currentState },
    });
  }
  if (path.endsWith("entry")) return response(fixture.v2.entry);
  if (path.endsWith("report")) return response(fixture.v2.report);
  if (path.endsWith("logout")) return new Response(null, { status: 204 });
  if (path.endsWith("save/resolve")) return response(await applied(savedLost!));
  if (path.endsWith("save")) {
    const input = JSON.parse(String(options?.body)) as ConsumerSaveInputV2;
    const result = await applied(input);
    if (dropNextSave) {
      dropNextSave = false;
      savedLost = input;
      throw Error("synthetic lost acknowledgement");
    }
    return response(result);
  }
  throw Error("Unexpected synthetic request");
};
const createController = (id: string) => {
  const owner = new ConsumerControllerV2(
    id,
    {
      getItem: (key) => sessionStorage.getItem(key),
      setItem: (key, value) => sessionStorage.setItem(key, value),
      removeItem: (key) => sessionStorage.removeItem(key),
    },
    fetcher,
  );
  owners.push(owner);
  return owner;
};
const runtime = {
  descriptor: {},
  Experience: ConsumerExperienceV2,
} as ConsumerExperienceRuntimeV2;
let root = createRoot(document.getElementById("root")!);
function mount(next: Mode, deep = false) {
  mode = next;
  root.unmount();
  root = createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      <CurrentConsumerSession
        sessionId={
          next === "legacy"
            ? fixture.v1.session.sessionId
            : fixture.v2.session.sessionId
        }
        {...(deep ? { initialScreen: "report" } : {})}
        fetcher={fetcher}
        renderV1={(props) => (
          <p data-legacy-screen={props.initialScreen ?? "play"}>合成旧版分派</p>
        )}
        renderV2={(props) => (
          <ConsumerSessionRuntimeV2
            {...props}
            createController={createController}
            resolveRuntime={() => (mode === "unsupported" ? null : runtime)}
          />
        )}
      />
    </StrictMode>,
  );
}
Object.assign(window, {
  sessionProbe: {
    calls,
    owners,
    mount,
    dropNextSave: () => {
      dropNextSave = true;
    },
    unmount: () => root.unmount(),
    release: () => release?.(),
    liveOwners: () => owners.filter((owner) => owner.task() !== null).length,
  },
});
mount("editable");
