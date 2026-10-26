import type { ConsumerV2HostProps } from "@/lib/consumer-contract/v2/client-contract";

/** Local reading navigation only; it does not grant write/completion authority. */
export type ConsumerReadingPageV2 =
  | "cover"
  | "preference"
  | "question"
  | "resume"
  | "review"
  | "result"
  | "report"
  | "poster";
export type ConsumerViewPropsV2 = ConsumerV2HostProps & {
  onRead: (page: ConsumerReadingPageV2) => void;
};

export type ConsumerExperiencePropsV2 = ConsumerV2HostProps & {
  initialScreen?: "report";
};
