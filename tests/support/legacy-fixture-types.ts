import type { FrozenCandidate } from "@/features/quizpack/validation/transactions-contract";
import type {
  InternalVersionDetail,
  InternalVersionSnapshot,
} from "@/features/product/internal-versions/contracts";
import type {
  InternalPlayDetail,
  InternalPlaySnapshot,
} from "@/features/product/internal-play/contracts";

/** Exact schemas already fixed by these historical fixtures' input bytes. Type-only; no parsing or compatibility path. */
export type FixtureCandidate<
  S extends FrozenCandidate["facts"]["content"]["schemaVersion"],
> = FrozenCandidate & {
  facts: {
    content: Extract<FrozenCandidate["facts"]["content"], { schemaVersion: S }>;
  };
};
export type VersionSnapshotV1 = Extract<
  InternalVersionSnapshot,
  { schemaVersion: "quizforge.internal-version-snapshot.v1" }
>;
export type VersionDetailV1 = InternalVersionDetail & {
  snapshot: VersionSnapshotV1;
};
export type PlaySnapshotV1 = Extract<
  InternalPlaySnapshot,
  { schemaVersion: "quizforge.internal-play-snapshot.v1" }
>;
export type PlayDetailV1 = InternalPlayDetail & { snapshot: PlaySnapshotV1 };
