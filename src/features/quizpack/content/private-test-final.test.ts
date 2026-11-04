import experience from "./private-test-registration-known-ten-experience.json";
import knownTen from "./private-test-registration-known-ten-final.json";
import { expect, it } from "vitest";
import demo from "./private-test-registration-final-demo.json";
import e2e from "./private-test-registration-final-e2e.json";
import {
  registeredPrivateTestSource,
  privateTestMarkerMatches,
} from "./private-test";
import { matchCurrentRegisteredBaseline } from "@/features/product/internal-versions/baseline-registry-v2";

it.each([demo, e2e, knownTen, experience])(
  "binds final source, marker and private baseline to its exact instance $instanceId",
  (r) => {
    expect(registeredPrivateTestSource(r)).toEqual(r);
    const other = r.instanceId === demo.instanceId ? e2e : demo;
    const marker = {
      schemaVersion: "quizforge.private-test-use.v1",
      instanceId: r.instanceId,
      authorizationId: r.authorizationId,
      contentStatus: "candidate",
      resourceStatus: "reference-or-candidate",
    };
    expect(privateTestMarkerMatches(marker, r)).toBe(true);
    expect(
      privateTestMarkerMatches({ ...marker, instanceId: other.instanceId }, r),
    ).toBe(false);
    expect(
      privateTestMarkerMatches(
        { ...marker, authorizationId: "qztx-prototype-rebuild-20261031" },
        r,
      ),
    ).toBe(false);
    const baseline = matchCurrentRegisteredBaseline(r, "test")!;
    expect(baseline.descriptor.approval).toMatchObject({
      kind: "private-test-only",
      instanceId: r.instanceId,
      authorizationId: r.authorizationId,
    });
    expect(matchCurrentRegisteredBaseline(r, "demo")).toBeNull();
    expect(matchCurrentRegisteredBaseline(r, "ci")).toBeNull();
    for (const k of [
      "productId",
      "canonicalContentSha256",
      "assetSetSha256",
      "canonicalManifestSha256",
    ] as const) {
      const changed = {
        ...r,
        [k]: k === "productId" ? "other" : "0".repeat(64),
      };
      expect(registeredPrivateTestSource(changed)).toBeNull();
      expect(matchCurrentRegisteredBaseline(changed, "test")).toBeNull();
    }
    expect(
      registeredPrivateTestSource({
        ...r,
        canonicalManifestSha256: other.canonicalManifestSha256,
      }),
    ).toBeNull();
  },
);
