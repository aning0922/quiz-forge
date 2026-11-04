import {
  CONSUMER_REEXCHANGE_COPY,
  type ConsumerReexchangeReason,
} from "@/lib/consumer-contract/policy-display";
import styles from "./reexchange-notice.module.css";

/** Navigation only: never exchanges a Key, changes pending, or grants authority. */
export function ConsumerReexchangeNotice({
  reason,
}: {
  reason?: ConsumerReexchangeReason | undefined;
}) {
  if (!reason) return null;
  return (
    <div className={styles.notice} data-consumer-reexchange={reason}>
      <p role="status">{CONSUMER_REEXCHANGE_COPY[reason]}</p>
      <a href="/access">{CONSUMER_REEXCHANGE_COPY.action}</a>
    </div>
  );
}
