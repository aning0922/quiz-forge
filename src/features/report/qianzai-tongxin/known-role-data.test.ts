import { describe, expect, it } from "vitest";
import { QIANZAI_KNOWN_TEN_ROLES } from "./known-ten-catalog";
import {
  QIANZAI_KNOWN_ROLE_DATA,
  qianzaiKnownRoleText,
} from "./known-role-data";
import { QIANZAI_KNOWN_ROLE_ART_PLAN } from "./known-role-art-plan";

describe("author-confirmed known roster editorial closure", () => {
  it("closes the exact versioned roster with historical identities, complete copy and four distinct selectors", () => {
    const ids = [
      "li-bai",
      "su-shi",
      "tang-yin",
      "zhou-yu",
      "zhao-yun",
      "li-qingzhao",
      "yang-yuhuan",
      "wu-zetian",
      "wang-zhaojun",
      "cai-wenji",
    ];
    expect(QIANZAI_KNOWN_TEN_ROLES.map((r) => r.id)).toEqual(ids);
    expect(QIANZAI_KNOWN_ROLE_DATA.map((r) => r.profile.ref.id)).toEqual(ids);
    expect(QIANZAI_KNOWN_ROLE_ART_PLAN.map((r) => r.id)).toEqual(ids);
    const selectors = new Set<string>();
    for (const [i, data] of QIANZAI_KNOWN_ROLE_DATA.entries()) {
      const role = QIANZAI_KNOWN_TEN_ROLES[i]!;
      expect(data.profile.displayName).toBe(role.displayName);
      expect(data.profile.sourceKind).toBe("documented-historical");
      expect(data.profile.ref).toEqual(role.ref);
      expect(role.designTargets).toHaveLength(5);
      expect(role.designTargets.every((n) => n >= 0 && n <= 100)).toBe(true);
      expect(data.profile.quotes).toHaveLength(2);
      expect(
        data.profile.quotes.every(
          (q) => q.source && q.sourceUrl.startsWith("https://"),
        ),
      ).toBe(true);
      expect(data.profile.history.timeline).toHaveLength(3);
      expect(Object.keys(data.copy.whyByTopic).sort()).toEqual([
        "action",
        "care",
        "change",
        "exploration",
        "voice",
      ]);
      expect(data.copy.neutralWhy).toHaveLength(2);
      expect(data.copy.closing).toHaveLength(3);
      expect(data.resourceRefs).toEqual(role.resourceRefs);
      for (const ref of Object.values(data.resourceRefs)) {
        expect(ref.version).toBe("3.0.0");
        expect(selectors.has(ref.id)).toBe(false);
        selectors.add(ref.id);
      }
    }
    expect(selectors.size).toBe(40);
  });

  it("keeps all display prose in an answer-free corpus and identifies narrator quotes rather than inventing self-quotes", () => {
    const corpus = qianzaiKnownRoleText();
    expect(corpus.join("")).not.toMatch(
      /https?:|RAW_|q\d{2}-|Q\d{2}|qztx-known-/u,
    );
    for (const data of QIANZAI_KNOWN_ROLE_DATA) {
      for (const q of data.profile.quotes) {
        expect(corpus).toContain(q.text);
        expect(corpus).toContain(q.source);
      }
      for (const text of [
        ...Object.values(data.copy.whyByTopic),
        ...data.copy.neutralWhy,
        ...data.copy.closing,
      ])
        expect(corpus).toContain(text);
    }
    for (const id of [
      "zhou-yu",
      "zhao-yun",
      "yang-yuhuan",
      "wu-zetian",
      "wang-zhaojun",
      "cai-wenji",
    ]) {
      const data = QIANZAI_KNOWN_ROLE_DATA.find(
        (r) => r.profile.ref.id === id,
      )!;
      expect(
        data.profile.quotes.every((q) => /史家叙述|时谣/u.test(q.source)),
      ).toBe(true);
    }
  });
});
