import { createRoot } from "react-dom/client";
import { CurrentFixedRevisionPreviewPage } from "./current-page";
import { InternalProductAuthority } from "../internal-versions/authority";
import { StudioClientError } from "../client";
import type { StudioSessionDto } from "../contracts";
import type { temporaryPreviewFixtureV2 } from "@/features/product/preview/v2.test-support";
const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as {
  any: Awaited<ReturnType<typeof temporaryPreviewFixtureV2>>;
  female: Awaited<ReturnType<typeof temporaryPreviewFixtureV2>>;
};
const authority = new InternalProductAuthority(fixture.any.scope.productId);
const calls: { path: string; method: string }[] = [];
let hold = true;
const pending: (() => void)[] = [];
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
window.fetch = async (url, options) => {
  const path = String(url),
    method = options?.method ?? "GET";
  calls.push({ path, method });
  if (path.endsWith("/current"))
    return json({
      ok: true,
      value: { mode: "structured", value: fixture.any.entry },
    });
  if (path.endsWith("/current/score")) {
    const input = JSON.parse(String(options?.body));
    const f =
      input.matchingContext.preference === "female"
        ? fixture.female
        : fixture.any;
    const response = () =>
      json({ ok: true, value: { ...f.result, requestId: input.requestId } });
    if (hold)
      return new Promise<Response>((resolve) =>
        pending.push(() => resolve(response())),
      );
    return response();
  }
  throw Error("Unexpected synthetic endpoint");
};
const session: StudioSessionDto = {
  operator: {
    id: "11111111-1111-4111-8111-111111111111",
    loginName: "synthetic",
    displayName: "合成测试",
    role: "admin",
    accountRevision: 1,
  },
  csrfToken: "synthetic-csrf",
  idleExpiresAt: "2026-10-27T12:00:00.000Z",
  absoluteExpiresAt: "2026-10-28T12:00:00.000Z",
};
const root = createRoot(document.getElementById("root")!);
function render() {
  root.render(
    <CurrentFixedRevisionPreviewPage
      scope={{ ...fixture.any.scope }}
      session={session}
      authority={authority}
      embedded
    />,
  );
}
Object.assign(window, {
  previewProbe: {
    calls,
    fixture,
    render,
    hold: (value: boolean) => {
      hold = value;
    },
    release: () => pending.shift()?.(),
    revoke: () => authority.observe(new StudioClientError("CAPABILITY_DENIED")),
    unmount: () => root.unmount(),
  },
});
render();
