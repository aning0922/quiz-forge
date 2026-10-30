import "server-only";
import {
  assertConsumerTx,
  type ConsumerTx,
} from "@/lib/db/consumer-transaction";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import type { InternalVersionSnapshot } from "@/features/product/internal-versions/contracts";
import { readFrozenDraftSourceEvidenceReadonly } from "./draft-source-evidence";
import { parseCurrentContent } from "./content/current";

/** Fixed-source SQL port only. No current head, execution resolver, filesystem or client-selected source. */
export async function readConsumerFixedSource(
  tx: ConsumerTx,
  parent: InternalVersionSnapshot,
) {
  assertConsumerTx(tx);
  const v = parent.validation;
  const evidence = await readFrozenDraftSourceEvidenceReadonly(
    tx.sql,
    {
      productId: parent.productId,
      sourceImportId: v.sourceImportId,
      sourceValidationId: v.sourceValidationId,
    },
    {
      expectedValidationStateRevision: v.sourceValidationStateRevision,
      expectedCandidateSha256: v.candidateSha256,
    },
  );
  if (
    evidence.canonicalContentSha256 !== parent.target.canonicalContentSha256 ||
    evidence.assetSetSha256 !== parent.target.assetSetSha256 ||
    evidence.canonicalManifestSha256 !==
      parent.target.canonicalManifestSha256 ||
    evidence.packId !== parent.packId ||
    evidence.packVersion !== parent.packVersion ||
    evidence.contentSchemaVersion !== parent.contentSchemaVersion ||
    evidence.contentKind !== parent.contentKind ||
    !sameConsumerFact(evidence.versions, parent.versions, L.playRequestBytes) ||
    !sameConsumerFact(
      evidence.validation,
      parent.validation,
      L.playRequestBytes,
    )
  )
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  const content = parseCurrentContent(
    JSON.parse(evidence.canonicalContentText),
  );
  if (
    !content.ok ||
    content.value.schemaVersion !== parent.contentSchemaVersion ||
    (content.value.schemaVersion !== "quizpack-content.v2" &&
      content.value.schemaVersion !== "quizpack-content.v3")
  )
    throw new ConsumerError("UNSUPPORTED_IMPLEMENTATION");
  return Object.freeze({ evidence, content: content.value });
}
export type ConsumerFixedSource = Awaited<
  ReturnType<typeof readConsumerFixedSource>
>;
