import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  CONSUMER_E2E_CASES,
  CONSUMER_FIXTURE_PRIVATE_NAME,
  CONSUMER_OBSERVATIONS_PRIVATE_NAME,
  CONSUMER_FIXTURE_MAX_BYTES,
  consumerFixtureSchema,
  consumerFixtureObservationsSchema,
  consumerFixtureSuiteCompletionSchema,
  type ConsumerFixtureObservations,
} from "../db/p4-consumer-fixture-contract";

const unavailable = () => Error("CONSUMER_E2E_PRIVATE_FIXTURE_UNAVAILABLE");
export function consumerRunId() {
  const value = process.env.QF_CONSUMER_E2E_RUN_ID;
  if (
    !value ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    throw unavailable();
  return value;
}
async function directory() {
  const file = process.env.QUIZFORGE_P2A_CONFIG;
  if (!file || !path.isAbsolute(file)) throw unavailable();
  const directory = path.dirname(file),
    st = await lstat(directory);
  if (
    path.dirname(directory) !== path.resolve(".cache/p2a") ||
    !/^[a-f0-9]{32}$/.test(path.basename(directory)) ||
    (await realpath(directory)) !== directory ||
    !st.isDirectory() ||
    (st.mode & 0o777) !== 0o700 ||
    st.uid !== process.getuid?.()
  )
    throw unavailable();
  return directory;
}
export async function readConsumerE2eFixture() {
  try {
    const dir = await directory(),
      file = await open(
        path.join(dir, CONSUMER_FIXTURE_PRIVATE_NAME),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    try {
      const st = await file.stat();
      if (
        !st.isFile() ||
        st.nlink !== 1 ||
        (st.mode & 0o777) !== 0o600 ||
        st.uid !== process.getuid?.() ||
        st.size > CONSUMER_FIXTURE_MAX_BYTES
      )
        throw unavailable();
      const bytes = Buffer.alloc(CONSUMER_FIXTURE_MAX_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const part = await file.read(
          bytes,
          length,
          bytes.length - length,
          length,
        );
        if (!part.bytesRead) break;
        length += part.bytesRead;
      }
      const after = await file.stat();
      if (
        length > CONSUMER_FIXTURE_MAX_BYTES ||
        length !== st.size ||
        after.dev !== st.dev ||
        after.ino !== st.ino ||
        after.size !== st.size ||
        after.mtimeMs !== st.mtimeMs ||
        after.uid !== st.uid ||
        after.nlink !== 1 ||
        (after.mode & 0o777) !== 0o600
      )
        throw unavailable();
      const result = consumerFixtureSchema.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(0, length),
          ),
        ),
      );
      if (
        result.instanceId !== path.basename(dir) ||
        result.runId !== consumerRunId() ||
        !result.prepared ||
        result.finished ||
        result.completed
      )
        throw unavailable();
      return result;
    } finally {
      await file.close();
    }
  } catch {
    throw unavailable();
  }
}
export async function consumerFixtureCommand(mode: "prepare" | "finish") {
  try {
    await promisify(execFile)(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        path.resolve("tests/db/p4-consumer-fixture.ts"),
        mode,
        consumerRunId(),
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: 90_000,
        maxBuffer: 4096,
      },
    );
  } catch {
    throw Error("CONSUMER_E2E_FIXTURE_COMMAND_FAILED");
  }
}
export async function writeConsumerE2eObservations(
  input: ConsumerFixtureObservations,
) {
  try {
    const value = consumerFixtureObservationsSchema.parse(input),
      dir = await directory();
    if (
      value.instanceId !== path.basename(dir) ||
      value.runId !== consumerRunId() ||
      value.mode !== "consumer-e2e"
    )
      throw unavailable();
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > CONSUMER_FIXTURE_MAX_BYTES) throw unavailable();
    const file = await open(
      path.join(dir, CONSUMER_OBSERVATIONS_PRIVATE_NAME),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
  } catch {
    throw unavailable();
  }
}
/** Only the eight actual successful first-run cases may seal the physical fixture. */
export class ConsumerSuiteCompletion {
  #cases = new Map<
    string,
    {
      caseId: (typeof CONSUMER_E2E_CASES)[number];
      status: "passed";
      expectedStatus: "passed";
      retry: 0;
      repeatEachIndex: 0;
    }
  >();
  #invalid = false;
  observe(info: {
    title: string;
    status?: string;
    expectedStatus: string;
    retry: number;
    repeatEachIndex: number;
  }) {
    const caseId = CONSUMER_E2E_CASES.find((c) => c === info.title);
    if (
      !caseId ||
      this.#cases.has(caseId) ||
      info.status !== "passed" ||
      info.expectedStatus !== "passed" ||
      info.retry !== 0 ||
      info.repeatEachIndex !== 0
    )
      this.#invalid = true;
    else
      this.#cases.set(caseId, {
        caseId,
        status: "passed",
        expectedStatus: "passed",
        retry: 0,
        repeatEachIndex: 0,
      });
  }
  canFinish() {
    return !this.#invalid && this.#cases.size === CONSUMER_E2E_CASES.length;
  }
  receipt() {
    if (!this.canFinish()) throw Error("CONSUMER_E2E_SUITE_INCOMPLETE");
    return consumerFixtureSuiteCompletionSchema.parse({
      schemaVersion: "quizforge.consumer-fixture-suite-completion.v1",
      runId: consumerRunId(),
      cases: CONSUMER_E2E_CASES.map((c) => this.#cases.get(c)),
    });
  }
}
