import type { ReactNode } from "react";
import type {
  DisplayAnswers,
  DisplayEntryBodyV1,
  ResultDisplaySnapshotV1,
} from "@/lib/assessment-contract/display-v1";

/** Presentation only. The host verifies source, runtime mapping and server facts. */
export type ConsumerMediaPresentation =
  | Readonly<{ kind: "ready"; content: ReactNode }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "unavailable"; onRetry?: () => void }>;

/** No default saved state: the host supplies a verified receipt/state observation. */
export type ConsumerSavePresentation =
  | Readonly<{ kind: "unsaved" }>
  | Readonly<{
      kind: "saved";
      stateRevision: number;
      savedAt: string | null;
    }>;

export type ConsumerBlockedReason =
  "saving" | "unknown" | "conflict" | "authority-lost" | "unavailable";

/** Blocked views receive no editing callbacks, including progress navigation. */
export type ConsumerControls<Actions> =
  | Readonly<{
      kind: "enabled";
      save: ConsumerSavePresentation;
      actions: Readonly<Actions>;
    }>
  | Readonly<{ kind: "blocked"; reason: ConsumerBlockedReason }>;

type EntryPresentation = Readonly<{
  entry: DisplayEntryBodyV1;
}>;

export type ConsumerCoverProps = EntryPresentation &
  Readonly<{
    media: ConsumerMediaPresentation;
    answers: DisplayAnswers;
    controls: ConsumerControls<{ onStart: () => void }>;
  }>;

export type ConsumerQuestionProps = EntryPresentation &
  Readonly<{
    media: ConsumerMediaPresentation;
    questionId: string;
    answers: DisplayAnswers;
    controls: ConsumerControls<{
      onChoose: (questionId: string, optionId: string) => void;
      onMove: (questionId: string) => void;
      onOverview: () => void;
      /** Opens completion review; never scores or submits from the view. */
      onReviewCompletion: () => void;
    }>;
  }>;

export type ConsumerResumeProps = EntryPresentation &
  Readonly<{
    answers: DisplayAnswers;
    controls: ConsumerControls<{
      onContinue: () => void;
      onQuestion: (questionId: string) => void;
      onCover: () => void;
      onReviewCompletion: () => void;
    }>;
  }>;

/** Completed views receive the stored display snapshot and read-only navigation. */
type CompletedPresentation = Readonly<{
  display: ResultDisplaySnapshotV1;
  media: ConsumerMediaPresentation;
}>;

export type ConsumerResultProps = CompletedPresentation &
  Readonly<{
    onReport: () => void;
    onPoster: () => void;
  }>;

export type ConsumerReportProps = CompletedPresentation &
  Readonly<{
    onResult: () => void;
    onPoster: () => void;
  }>;

export type ConsumerPosterExportPresentation =
  | Readonly<{ kind: "idle"; onExport: () => void }>
  | Readonly<{ kind: "exporting" }>
  | Readonly<{ kind: "ready"; onDownload: () => void }>
  | Readonly<{
      kind: "unavailable";
      reason: "font" | "resource" | "layout" | "encoding" | "authority-lost";
      onRetry?: () => void;
    }>;

export type ConsumerPosterProps = CompletedPresentation &
  Readonly<{
    exportState: ConsumerPosterExportPresentation;
    onReport: () => void;
  }>;

export type ConsumerViewProps = Readonly<{
  cover: ConsumerCoverProps;
  question: ConsumerQuestionProps;
  resume: ConsumerResumeProps;
  result: ConsumerResultProps;
  report: ConsumerReportProps;
  poster: ConsumerPosterProps;
}>;
