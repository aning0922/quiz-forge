import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { verifyConsumerAccessGateway } from "../../../../scripts/verify-consumer-access-gateway";
import { CONSUMER_ACCESS_GATEWAY } from "./access-gateway-binding";
import { ConsumerAccessGateway } from "./access-gateway";
import {
  CONSUMER_IMPLEMENTATION_AVAILABILITY,
  CONSUMER_IMPLEMENTATION_DESCRIPTORS,
} from "./implementation-catalog";
import { consumerImplementationDescriptorSha256 } from "./implementation-schema";

const compiled = Object.values(CONSUMER_IMPLEMENTATION_AVAILABILITY);
const verify = (
  binding: unknown = CONSUMER_ACCESS_GATEWAY,
  overrideRead?: (path: string) => Promise<Buffer>,
) =>
  verifyConsumerAccessGateway(
    process.cwd(),
    binding,
    CONSUMER_IMPLEMENTATION_DESCRIPTORS,
    compiled,
    overrideRead,
  );
describe("explicit unauthenticated consumer gateway binding", () => {
  it("verifies the selected browser entry and actual static App render without importing browser code in the gate", async () => {
    await expect(verify()).resolves.toEqual(CONSUMER_ACCESS_GATEWAY);
    const markup = renderToStaticMarkup(createElement(ConsumerAccessGateway));
    expect(markup).toContain('data-consumer-access-version="1.0.1"');
    expect(markup).toContain(
      `data-consumer-access-entry="${CONSUMER_ACCESS_GATEWAY.renderer.entrySha256}"`,
    );
    expect(markup).toContain(
      `data-consumer-access-protocol="${CONSUMER_ACCESS_GATEWAY.protocol}"`,
    );
    expect(markup).not.toMatch(/qf[kg]_p4_/);
  });
  it("rejects old renderer selection, mixed identity, unknown protocol/module/export and supplied extra selection fields", async () => {
    const binding = CONSUMER_ACCESS_GATEWAY;
    for (const changed of [
      { ...binding, renderer: CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1 },
      {
        ...binding,
        renderer: {
          ...binding.renderer,
          entrySha256:
            CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1.entrySha256,
        },
      },
      { ...binding, sourcePath: "src/features/theme/consumer-v1/access.tsx" },
      { ...binding, exportName: "ConsumerAccessV1" },
      { ...binding, protocol: "quizforge.consumer-access.v2" },
      { ...binding, fallback: "latest" },
    ]) {
      await expect(verify(changed)).rejects.toThrow();
    }
  });
  it("rejects a valid new descriptor whose Access is not a browser entry, independently of its metadata checksum", async () => {
    const entry = structuredClone(
      CONSUMER_IMPLEMENTATION_DESCRIPTORS.find(
        (e) => e.descriptor.version === "1.0.1",
      )!,
    );
    const access = entry.descriptor.closure.entrypoints.find(
      (e) => e.path === CONSUMER_ACCESS_GATEWAY.sourcePath,
    )!;
    access.runtime = "server";
    const { consumerImplementationClosureSha256 } =
      await import("./implementation-schema");
    entry.descriptor.implementationSha256 =
      await consumerImplementationClosureSha256(entry.descriptor.closure);
    entry.entrySha256 = await consumerImplementationDescriptorSha256(
      entry.descriptor,
    );
    const renderer = {
      ...CONSUMER_ACCESS_GATEWAY.renderer,
      entrySha256: entry.entrySha256,
    };
    await expect(
      verifyConsumerAccessGateway(
        process.cwd(),
        { ...CONSUMER_ACCESS_GATEWAY, renderer },
        [entry],
        [renderer],
      ),
    ).rejects.toThrow("CONSUMER_GATEWAY_ENTRYPOINT_MISMATCH");
  });
  it("rejects a stale static import or JSX render even when all public gateway metadata still says 1.0.1", async () => {
    for (const [path, from, to] of [
      [
        "src/features/product/internal-play/access-gateway.tsx",
        "@/features/theme/consumer-v1-1/access",
        "@/features/theme/consumer-v1/access",
      ],
      [
        "src/features/product/internal-play/access-gateway.tsx",
        "<ConsumerAccessV1_1 />",
        "<ConsumerAccessV1 />",
      ],
      [
        "src/app/(consumer)/access/page.tsx",
        "<ConsumerAccessGateway />",
        "<ConsumerAccessV1 />",
      ],
      [
        "src/app/(consumer)/access/page.tsx",
        "@/features/product/internal-play/access-gateway",
        "@/features/theme/consumer-v1/access",
      ],
      [
        "src/features/product/internal-play/access-gateway.tsx",
        "<ConsumerAccessV1_1 />",
        "{Boolean(<ConsumerAccessV1_1 />)}",
      ],
      [
        "src/app/(consumer)/access/page.tsx",
        "return <ConsumerAccessGateway />;",
        "return Boolean(<ConsumerAccessGateway />);",
      ],
      [
        "src/features/product/internal-play/access-gateway.tsx",
        "<ConsumerAccessV1_1 />",
        "{false ? <ConsumerAccessV1_1 /> : null}",
      ],
      [
        "src/features/product/internal-play/access-gateway.tsx",
        "const { renderer, protocol } = CONSUMER_ACCESS_GATEWAY;",
        "const { renderer, protocol } = CONSUMER_ACCESS_GATEWAY; const ConsumerAccessV1_1 = () => null;",
      ],
      [
        "src/app/(consumer)/access/page.tsx",
        "return <ConsumerAccessGateway />;",
        "const unused = <ConsumerAccessGateway />; return null;",
      ],
    ]) {
      await expect(
        verify(undefined, async (file) => {
          const source = await readFile(file);
          if (file !== path) return source;
          expect(source.toString()).toContain(from!);
          return Buffer.from(source.toString().replace(from!, to!));
        }),
      ).rejects.toThrow("CONSUMER_GATEWAY_STATIC_WIRING_MISMATCH:" + path);
    }
  });
});
