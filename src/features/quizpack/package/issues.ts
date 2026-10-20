import type { PackIssue } from "../v1/api";
import type { IssueBatch } from "./api";
/** Control markers never become report business issues; every upstream loss is retained. */
export function collectIssues(
  issues: readonly PackIssue[],
  limit: number,
  upstreamTruncated = false,
): IssueBatch {
  const batch: IssueBatch = { issues: [], issuesTruncated: upstreamTruncated };
  for (const issue of issues) {
    if (issue.code === "ISSUES_TRUNCATED") {
      batch.issuesTruncated = true;
      continue;
    }
    if (batch.issues.length < limit) batch.issues.push(issue);
    else batch.issuesTruncated = true;
  }
  return batch;
}
