import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { LaunchFailureCode } from "../../contracts";
import type { beginMediaImage } from "../../operation-context";
import type { CommandOptions, CommandResult } from "./command";
import type { LinuxRunRecord } from "./container-policy.mjs";
import type { LinuxFiles } from "./files.mjs";
export type LinuxImageScope = NonNullable<ReturnType<typeof beginMediaImage>>;
export interface LinuxExecutionPlan {
  entrypoint:
    "/usr/local/bin/node" | "/worker/posix-probe" | "/worker/native-probe";
  args: readonly string[];
}
export interface LinuxPolicy {
  image: { imageId: string };
  binding: {
    seccompSha256: string;
    daemon: { id: string };
    dependencies: {
      node: string;
      sharp: string;
      vips: string;
      workerSha256: string;
    } | null;
  };
  profileId: string;
}
export type LinuxDiagnostic = {
  phase:
    | "policy-image-inspect"
    | "policy-daemon-info"
    | "policy-capabilities"
    | "policy-runtime-versions"
    | "container-inspect-command"
    | "container-checks"
    | "container-state"
    | "create"
    | "start-attach"
    | "launcher-catch";
  exitCode?: number | null;
  settled?: boolean;
  reason?: string | null;
  stderrCategory?: string;
  knownSyscall?: string | null;
  errno?: string | null;
  fifoOperation?: string | null;
  reference?: string | null;
  checks?: Record<string, boolean>;
  matched?: boolean;
  running?: boolean;
  oomKilled?: boolean;
  status?:
    | "created"
    | "exited"
    | "running"
    | "paused"
    | "dead"
    | "restarting"
    | "removing"
    | "unknown";
  errorCategory?: string;
  failure?: string;
  issued?: boolean;
};
export interface LinuxHooks {
  diagnostic?: (event: LinuxDiagnostic) => void;
  createSpawn?: (child: ChildProcessWithoutNullStreams) => void;
  startSpawn?: (child: ChildProcessWithoutNullStreams) => void;
  afterPolicy?: (policy: LinuxPolicy) => void | Promise<void>;
  afterCreate?: (
    record: LinuxRunRecord,
    result: CommandResult,
  ) => void | Promise<void>;
  afterStart?: (
    record: LinuxRunRecord,
    result: CommandResult,
  ) => void | Promise<void>;
}
export interface LinuxExecutionEnvironment extends LinuxFiles {
  controlRoot: string;
  seccompPath: string;
  docker(
    args: readonly string[],
    options?: CommandOptions,
  ): Promise<CommandResult>;
  json(bytes: Uint8Array): unknown;
  loadPolicy(options: {
    deadline: number;
    signal?: AbortSignal;
    scope?: LinuxImageScope;
    onDiagnostic?: (event: LinuxDiagnostic) => void;
    controlCommand?: LinuxExecutionEnvironment["docker"];
  }): Promise<LinuxPolicy>;
}
export type LinuxStopEvidence = Readonly<{
  containerStopped: true;
  stdioSettled: boolean;
  containerId: string;
  state: "created" | "exited";
  exitCode: number;
  oomKilled: boolean;
  identityMatched: true;
}>;
export type LinuxOwnedResult =
  | {
      outcome: "exited";
      runId: string;
      profileId: string;
      stopped: "confirmed";
      stdout: Buffer;
      evidence: LinuxStopEvidence;
    }
  | {
      outcome: "failed";
      runId: string;
      profileId: string | null;
      code: LaunchFailureCode;
      stopped: "not-started" | "confirmed" | "unknown";
      evidence?: LinuxStopEvidence;
    };
export function createLinuxExecutionCore(
  environment: LinuxExecutionEnvironment,
): {
  execute(options: {
    execution: LinuxExecutionPlan;
    scope: LinuxImageScope;
    bytes: Uint8Array;
    deadlineMonotonicMs?: number;
    hooks?: LinuxHooks;
    preallocatedRunId?: string;
  }): Promise<LinuxOwnedResult>;
  readPolicy(options: {
    preallocatedRunId?: string;
    scope: LinuxImageScope;
    hooks?: LinuxHooks;
  }): Promise<LinuxPolicy>;
  verifyOwnStopped(beforeStartCrash?: {
    ownerClosed: true;
    createClosed: true;
    ownerPid: number;
    recordSha256: string;
  }): Promise<
    { stopped: "unknown" } | { stopped: "confirmed"; containerStopped: true }
  >;
};
