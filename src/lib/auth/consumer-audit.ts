import "server-only";
import { randomUUID } from "node:crypto";
import type { StudioActor } from "./capabilities";
import {
  assertConsumerTx,
  type ConsumerTx,
} from "@/lib/db/consumer-transaction";
type ConsumerAuditTarget =
  | {
      action: "internal_play_created";
      kind: "play";
      id: string;
      revision: number;
    }
  | {
      action: "access_key_issued" | "access_key_voided";
      kind: "access-key";
      id: string;
      revision: 1;
    };
/** Finite operator audit interface. No anonymous session/result history or credentials. */
export async function appendConsumerOperatorAudit(
  tx: ConsumerTx,
  actor: StudioActor,
  requestId: string,
  target: ConsumerAuditTarget,
): Promise<void> {
  assertConsumerTx(tx);
  await tx.sql`INSERT INTO qf.audit_event(id,occurred_at,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision) VALUES(${randomUUID()},clock_timestamp(),${target.action},'success',${actor.id},${actor.sessionId},${requestId},${target.kind},${target.id},${target.revision})`;
}
