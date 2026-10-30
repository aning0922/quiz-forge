import { createConsumerFlowService } from "@/features/fulfillment/consumer-flow/service";
import type { ConsumerFlowService } from "@/features/fulfillment/consumer-flow/service-contract";
import type {
  ConsumerSessionView,
  ConsumerSaveResolution,
  ConsumerCompleteResolution,
} from "@/features/fulfillment/consumer-flow/contracts";
import type { ConsumerEntryView } from "@/features/fulfillment/consumer-flow/display-contract";
import type { PersistedReportView } from "@/features/report/persisted/view-contracts";

type V1Results = {
  readSession: ConsumerSessionView;
  readEntry: ConsumerEntryView;
  save: ConsumerSaveResolution;
  resolveSave: ConsumerSaveResolution;
  complete: ConsumerCompleteResolution;
  resolveComplete: ConsumerCompleteResolution;
  readReport: PersistedReportView;
};
type ConsumerFlowServiceV1 = Omit<ConsumerFlowService, keyof V1Results> & {
  [K in keyof V1Results]: (
    ...args: Parameters<ConsumerFlowService[K]>
  ) => Promise<V1Results[K]>;
};
/** Only for existing tests whose sealed fixture explicitly fixes protocol v1. The actual service is unchanged. */
export const createConsumerFlowServiceV1 = createConsumerFlowService as (
  ...args: Parameters<typeof createConsumerFlowService>
) => ConsumerFlowServiceV1;
