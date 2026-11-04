import { describe, it, expect } from "vitest";
import { persistedReportFixture } from "@/features/report/persisted/contracts.test-support";
import { persistedReportFixtureV2 } from "@/features/report/persisted/contracts-v2.test-support";
import { testUuid } from "@/features/product/internal-play/contracts.test-support";
import {
  consumerSqlDomainError,
  consumerWrite,
  type ConsumerWriteObservation,
} from "./transaction";
import type { P2aDatabase } from "@/lib/db/client";
import {
  consumerPolicyBindingSha256,
  verifyConsumerPolicyResolution,
} from "./policy-contracts";
import {
  verifyCurrentCompleteResolution,
  verifyCurrentSessionViewResponse,
} from "./current-wire";

describe("latest attempt terminal contracts", () => {
  for (const [version, fixture] of [
    [1, persistedReportFixture],
    [2, persistedReportFixtureV2],
  ] as const) {
    it(`binds v${version} terminal evidence to the original request without cross-attempt report authority`, async () => {
      const report = await fixture(),
        binding = report.receipt.binding;
      const terminal = {
        schemaVersion: "quizforge.consumer-policy-resolution.v1",
        binding,
        bindingSha256: await consumerPolicyBindingSha256(binding),
        kind: "version-superseded",
        outcome: {
          kind: "version-superseded",
          session: binding.session,
          attemptGeneration: 0,
          currentGeneration: 2,
          requiresReexchange: true,
        },
      };
      expect(await verifyCurrentCompleteResolution(terminal, binding)).toEqual(
        terminal,
      );
      await expect(
        verifyConsumerPolicyResolution(terminal, {
          ...binding,
          completionKey: testUuid(99),
        }),
      ).rejects.toThrow();
      await expect(
        verifyConsumerPolicyResolution(
          {
            ...terminal,
            outcome: { ...terminal.outcome, currentGeneration: 0 },
          },
          binding,
        ),
      ).rejects.toThrow();
      await expect(
        verifyConsumerPolicyResolution(
          { ...terminal, report: report.receipt },
          binding,
        ),
      ).rejects.toThrow();
      const view = {
        schemaVersion: `quizforge.consumer-session-view.v${version}`,
        grant: {
          grantId: testUuid(55),
          session: binding.session,
          issuedAt: "2026-10-01T00:00:00.000Z",
          expiresAt: "2026-10-01T08:00:00.000Z",
          csrf: "A".repeat(43),
        },
        observedAt: "2026-10-01T01:00:00.000Z",
        keyExpiresAt: "2026-10-02T00:00:00.000Z",
        outcome: terminal.outcome,
      };
      expect(
        await verifyCurrentSessionViewResponse(view, binding.session.sessionId),
      ).toEqual(view);
      await expect(
        verifyCurrentSessionViewResponse(
          {
            ...view,
            outcome: {
              ...terminal.outcome,
              session: { ...binding.session, sessionId: testUuid(99) },
            },
          },
          binding.session.sessionId,
        ),
      ).rejects.toThrow();
    });
  }
  it("maps exact database errors and leaves unrelated constraints unclassified", () => {
    expect(
      consumerSqlDomainError({ code: "23514", message: "VERSION_SUPERSEDED" })
        ?.code,
    ).toBe("VERSION_SUPERSEDED");
    expect(
      consumerSqlDomainError({
        code: "23514",
        message: "CONSUMER_ACTIVATION_CONFLICT",
      })?.code,
    ).toBe("ACTIVATION_CONFLICT");
    expect(
      consumerSqlDomainError({
        code: "23514",
        message: "unrelated constraint",
      }),
    ).toBeUndefined();
    expect(
      consumerSqlDomainError({ code: "08006", message: "VERSION_SUPERSEDED" }),
    ).toBeUndefined();
  });
});

it("preserves connection-invalidated UNKNOWN before mapping an otherwise known domain error", async () => {
  for (const invalidated of [false, true]) {
    const fault = {
      code: "23514",
      message: "VERSION_SUPERSEDED",
      quizforgeConnectionInvalidated: invalidated,
    };
    const sql = async () => [];
    const db = {
      sql: {
        begin: async (
          _mode: string,
          callback: (tx: unknown) => Promise<unknown>,
        ) => callback(sql),
      },
    } as unknown as P2aDatabase;
    const observation: ConsumerWriteObservation = { kind: "not-started" };
    await expect(
      consumerWrite(
        db,
        () => {},
        observation,
        async () => {
          throw fault;
        },
      ),
    ).rejects.toMatchObject({
      code: invalidated ? "OUTCOME_UNKNOWN" : "VERSION_SUPERSEDED",
    });
    expect(observation.kind).toBe(invalidated ? "unknown" : "rolled-back");
  }
});
