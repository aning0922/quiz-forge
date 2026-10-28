"use client";
import { createContext, useContext } from "react";
import type {
  DisplayAssetV1,
  DisplayResourceTransport,
} from "@/lib/assessment-contract/display-v1";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { consumerResourceTransportV1 } from "../consumer-v1/resource";
import type { ConsumerControllerV2 } from "./controller";
import { ConsumerClientError } from "../consumer-v1/request";

export type ConsumerResourceLeaseV2 = Readonly<{
  view: object;
  generation: number;
  model: ConsumerV2ReaderModel;
  signal: AbortSignal;
  current(): boolean;
  transport: DisplayResourceTransport;
}>;
export type ConsumerResourcePortV2 = Readonly<{
  capture(view: object): ConsumerResourceLeaseV2 | null;
}>;
type ResourceAuthority = Pick<
  ConsumerControllerV2,
  "getSnapshot" | "task" | "revoke" | "sessionId" | "fetcher"
>;
let nextResourceGeneration = 0;
/** Bound to an actual authority ticket and verified view, never just a session ID. */
export function createConsumerResourcePortV2(
  owner: ResourceAuthority,
): ConsumerResourcePortV2 {
  return Object.freeze({
    capture(expectedView: object) {
      const model = owner.getSnapshot();
      if (model.phase === "denied") return null;
      const view = model.report?.view ?? model.entry;
      const task = owner.task();
      if (!view || view !== expectedView || !task?.current()) return null;
      const assets =
        model.report?.view.display.assets ?? model.entry?.assets ?? [];
      const current = () => {
        const next = owner.getSnapshot();
        return (
          task.current() &&
          next.phase !== "denied" &&
          (next.report?.view ?? next.entry) === view
        );
      };
      const read = consumerResourceTransportV1(
        owner.sessionId,
        { signal: task.signal, current },
        owner.revoke,
        owner.fetcher,
      );
      return Object.freeze({
        view,
        generation: ++nextResourceGeneration,
        model,
        signal: task.signal,
        current,
        transport: async (
          asset: DisplayAssetV1,
          signal: AbortSignal,
          deadline: number,
        ) => {
          if (
            !current() ||
            !assets.some((a) => sameConsumerFact(a, asset, 8192))
          )
            throw Error("CONSUMER_RESOURCE_SCOPE_CHANGED");
          let response: Response;
          try {
            response = await read(asset, signal, deadline);
          } catch (error) {
            if (
              error instanceof ConsumerClientError &&
              error.code === "KEY_NOT_ACTIVE" &&
              task.current()
            )
              owner.revoke();
            throw error;
          }
          if (!current()) {
            void response.body?.cancel().catch(() => undefined);
            throw Error("CONSUMER_RESOURCE_SCOPE_CHANGED");
          }
          return response;
        },
      });
    },
  });
}
export const ConsumerResourceContextV2 =
  createContext<ConsumerResourcePortV2 | null>(null);
export const useConsumerResourcePortV2 = () =>
  useContext(ConsumerResourceContextV2);
