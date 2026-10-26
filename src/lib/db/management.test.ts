import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArguments } from "../../../scripts/p2a-db-cli";
import { executeLocalAccountOperation } from "../auth/accounts/management";
import { initCiInstance, initLocalInstance, instancePaths } from "./management";

afterEach(() => {
  delete process.env.GITHUB_ACTIONS;
});
describe("P2-A management refusal boundaries", () => {
  it("rejects unknown, missing, duplicate and positional CLI input", () => {
    expect(parseArguments(["--instance", "a"], ["instance"])).toEqual({
      instance: "a",
    });
    for (const args of [
      [],
      ["--instance"],
      ["--instance", "a", "--instance", "b"],
      ["--instance", "a", "--reset", "true"],
      ["a"],
      ["--instance", "--all"],
    ])
      expect(() => parseArguments(args, ["instance"])).toThrow(
        "CLI_ARGUMENTS_INVALID",
      );
  });
  it("refuses nonlocal initialization before creating anything", async () => {
    await expect(
      initLocalInstance({
        port: 55421,
        origin: "http://localhost:3100",
        purpose: "test",
      }),
    ).rejects.toThrow("INIT_ARGUMENTS_INVALID");
  });
  it("confines instance paths to generated identifiers", () => {
    expect(instancePaths("a".repeat(32)).directory).toBe(
      path.join(process.cwd(), ".cache", "p2a", "a".repeat(32)),
    );
    for (const id of ["../existing", "", "a".repeat(31), "A".repeat(32)])
      expect(() => instancePaths(id)).toThrow();
  });
  it("rejects noncanonical maintenance inputs and unowned operation files before DB access", async () => {
    const binding = {
      action: "disable" as const,
      operationId: "00000000-0000-4000-8000-000000000001",
      targetId: "00000000-0000-4000-8000-000000000002",
      expectedRevision: 1,
    };
    await expect(
      executeLocalAccountOperation(
        "a".repeat(32),
        binding,
        "/tmp/account-operation-private.json",
      ),
    ).rejects.toThrow("ACCOUNT_OPERATION_PATH_INVALID");
    await expect(
      executeLocalAccountOperation(
        "a".repeat(32),
        { ...binding, expectedRevision: 0 },
        "/tmp/account-operation-private.json",
      ),
    ).rejects.toThrow();
  });
  it("does not permit arbitrary CI connections, even with a CI flag", async () => {
    const input = {
      host: "127.0.0.1",
      port: 55421,
      user: "postgres",
      password: "synthetic-service",
      database: "postgres",
    };
    await expect(initCiInstance(input)).rejects.toThrow(
      "CI_SERVICE_ARGUMENTS_INVALID",
    );
    process.env.GITHUB_ACTIONS = "true";
    for (const invalid of [
      { ...input, host: "localhost" },
      { ...input, host: "192.168.1.2" },
      { ...input, port: 5432 },
      { ...input, database: "existing" },
      { ...input, user: "existing" },
    ])
      await expect(initCiInstance(invalid)).rejects.toThrow(
        "CI_SERVICE_ARGUMENTS_INVALID",
      );
  });
});
