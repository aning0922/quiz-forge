export const LIMITS: Readonly<{
  bytes: number;
  dimension: number;
  pixels: number;
  executionMs: number;
  cleanupMs: number;
  stdout: number;
  stderr: number;
  memory: number;
  nanoCpus: number;
  pids: number;
}>;
export interface LinuxRunRecord {
  schema: "qf-linux-run.v1";
  runId: string;
  ownerPid: number;
  nonce: string;
  name: string;
  imageId: string;
  profileId: string;
  seccompSha256: string;
  daemonId: string;
  entrypoint: string;
  args: readonly string[];
  recordHash?: string;
}
export const INSPECT: string;
export function createArgs(
  record: LinuxRunRecord,
  entrypoint: string,
  args: readonly string[],
  seccompPath: string,
): string[];
export function containerChecks(
  container: unknown,
  record: LinuxRunRecord,
): Record<string, boolean>;
export function matches(container: unknown, record: LinuxRunRecord): boolean;
