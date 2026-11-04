import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { consumerEntryViewV2Schema } from "@/features/fulfillment/consumer-flow/display-contract-v2";
import { CONSUMER_REEXCHANGE_COPY } from "@/lib/consumer-contract/policy-display";
import { ConsumerControllerV2 } from "./controller";
import { ConsumerSessionRuntimeV2 } from "./experience";
import { structuredReaderFixtureV2 } from "./fixtures.test-support";
import { consumerSessionFixtureV2 } from "./session.test-support";
import { persistedReportViewV2Schema } from "@/features/report/persisted/view-contracts-v2";

it.each(["version-superseded", "entitlement-completed"] as const)(
  "shows the original-code entrance with no entry/report or installed runtime: %s",
  (reason) => {
    const { model } = structuredReaderFixtureV2();
    Object.assign(model, {
      phase: "unavailable",
      entry: null,
      report: null,
      reexchangeRequired: reason,
    });
    const owner = new ConsumerControllerV2("synthetic", sessionStoragePort());
    owner.getSnapshot = () => model;
    const resolve = vi.fn(() => null);
    const rendered = renderToStaticMarkup(
      createElement(ConsumerSessionRuntimeV2, {
        sessionId: "synthetic",
        resolveRuntime: resolve,
        createController: () => owner,
      }),
    );
    expect(rendered).toContain(CONSUMER_REEXCHANGE_COPY[reason]);
    expect(rendered).toContain('<a href="/access">使用原兑换码重新进入</a>');
    expect(resolve).not.toHaveBeenCalled();
  },
);

it("keeps the terminal entrance when an old entry has no current executable runtime", async () => {
  const f = await consumerSessionFixtureV2();
  const { model } = structuredReaderFixtureV2();
  Object.assign(model, {
    phase: "conflict",
    reexchangeRequired: "version-superseded",
    pendingOperation: "save",
  });
  const owner = new ConsumerControllerV2("synthetic", sessionStoragePort());
  const initial = owner.getInternalSnapshot();
  owner.getInternalSnapshot = () => ({
    ...initial,
    entry: consumerEntryViewV2Schema.parse(f.entry),
  });
  owner.getSnapshot = () => model;
  const resolve = vi.fn(() => null);
  const rendered = renderToStaticMarkup(
    createElement(ConsumerSessionRuntimeV2, {
      sessionId: "synthetic",
      resolveRuntime: resolve,
      createController: () => owner,
    }),
  );
  expect(resolve).toHaveBeenCalledOnce();
  expect(rendered).toContain('href="/access"');
  expect(rendered).toContain("采用已核对服务器记录");
  expect(rendered).toContain("操作继续保留");
});

it("retains UNKNOWN controls without manufacturing a terminal policy reason", () => {
  const { model } = structuredReaderFixtureV2();
  Object.assign(model, {
    phase: "unknown",
    pendingOperation: "complete",
    entry: null,
    report: null,
  });
  const owner = new ConsumerControllerV2("synthetic", sessionStoragePort());
  owner.getSnapshot = () => model;
  const rendered = renderToStaticMarkup(
    createElement(ConsumerSessionRuntimeV2, {
      sessionId: "synthetic",
      resolveRuntime: () => null,
      createController: () => owner,
    }),
  );
  expect(rendered).toContain("核对原操作");
  expect(rendered).toContain("操作继续保留");
  expect(rendered).not.toContain("data-consumer-reexchange");
  expect(rendered).not.toContain("使用原兑换码重新进入");
});

function sessionStoragePort() {
  return { getItem: () => null, setItem() {}, removeItem() {} };
}

it.each([null, undefined])(
  "an explicit historical rejection never falls through; unrelated editions delegate (%s)",
  async (result) => {
    const f = await consumerSessionFixtureV2();
    const { completed: model } = structuredReaderFixtureV2();
    const owner = new ConsumerControllerV2("synthetic", sessionStoragePort());
    const initial = owner.getInternalSnapshot();
    owner.getInternalSnapshot = () => ({
      ...initial,
      report: persistedReportViewV2Schema.parse(f.report),
    });
    owner.getSnapshot = () => model;
    const current = vi.fn(() => null),
      historical = vi.fn(() => result);
    renderToStaticMarkup(
      createElement(ConsumerSessionRuntimeV2, {
        sessionId: "synthetic",
        resolveRuntime: current,
        resolveHistoricalReport: historical,
        createController: () => owner,
      }),
    );
    expect(historical).toHaveBeenCalledOnce();
    expect(current).toHaveBeenCalledTimes(result === null ? 0 : 1);
  },
);
