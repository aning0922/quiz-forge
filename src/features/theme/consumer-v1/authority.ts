import {
  consumerSessionRefSchema,
  type ConsumerSessionRef,
} from "@/lib/consumer-contract/v1/primitives";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";

export type ConsumerAuthorityTicket = Readonly<{
  generation: number;
  session: ConsumerSessionRef;
}>;
/** One per mounted session host. Revocation is synchronous, including across reads/media/export. */
export class ConsumerAuthorityV1 {
  #generation = 0;
  #session: ConsumerSessionRef;
  #allowed = true;
  #tickets = new WeakSet<ConsumerAuthorityTicket>();
  constructor(session: unknown) {
    this.#session = Object.freeze(consumerSessionRefSchema.parse(session));
  }
  ticket(): ConsumerAuthorityTicket {
    const t = Object.freeze({
      generation: this.#generation,
      session: this.#session,
    });
    this.#tickets.add(t);
    return t;
  }
  current(ticket: ConsumerAuthorityTicket): boolean {
    return (
      this.#allowed &&
      this.#tickets.has(ticket) &&
      ticket.generation === this.#generation &&
      sameConsumerFact(ticket.session, this.#session, L.operationRequestBytes)
    );
  }
  revoke() {
    this.#allowed = false;
    this.#generation++;
  }
  /** Fresh authorized bootstrap creates a new generation, never revives an old ticket. */
  adopt(session: unknown) {
    this.#session = Object.freeze(consumerSessionRefSchema.parse(session));
    this.#generation++;
    this.#allowed = true;
  }
}
