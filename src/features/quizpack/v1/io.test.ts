import {
  mkdtemp,
  writeFile,
  readFile,
  symlink,
  mkdir,
  readdir,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalPackJson,
  parsePackJson,
  readLocalFile,
  readResourceFile,
  writeArchiveNoClobber,
} from "./io";
const roots: string[] = [];
const setup = async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "quizpack-io-")));
  roots.push(path);
  return path;
};
const signal = () => new AbortController().signal;
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
describe("QuizPack IO", () => {
  it("reads only explicit bounded files", async () => {
    const root = await setup();
    await writeFile(join(root, "content.json"), "abc");
    expect(
      await readLocalFile(join(root, "content.json"), 3, signal()),
    ).toEqual(Buffer.from("abc"));
    await expect(
      readLocalFile(join(root, "content.json"), 2, signal()),
    ).rejects.toMatchObject({ code: "INPUT_SIZE_LIMIT" });
    await expect(readLocalFile(root, 3, signal())).rejects.toMatchObject({
      code: "IO_SOURCE_NOT_FILE",
    });
  });
  it("rejects source links, parent links and directory escapes", async () => {
    const root = await setup();
    await mkdir(join(root, "real"));
    await writeFile(join(root, "real", "a.png"), "abc");
    await symlink(join(root, "real", "a.png"), join(root, "a.png"));
    await symlink(join(root, "real"), join(root, "alias"));
    for (const path of ["a.png", "alias/a.png"])
      await expect(
        readResourceFile(root, path, 3, signal()),
      ).rejects.toMatchObject({ code: "IO_SOURCE_LINK" });
    for (const path of [
      "../a.png",
      "/a.png",
      "real/../a.png",
      "real\\a.png",
      "real//a.png",
    ])
      await expect(
        readResourceFile(root, path, 3, signal()),
      ).rejects.toMatchObject({ code: "IO_SOURCE_OUTSIDE_ROOT" });
    expect(await readResourceFile(root, "real/a.png", 3, signal())).toEqual(
      Buffer.from("abc"),
    );
  });
  it("atomically refuses replacement and leaves no temporary files", async () => {
    const root = await setup();
    const path = join(root, "result.quizpack");
    const outcomes = await Promise.allSettled([
      writeArchiveNoClobber(path, Buffer.from("first"), signal()),
      writeArchiveNoClobber(path, Buffer.from("second"), signal()),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(outcomes.find((item) => item.status === "rejected")).toMatchObject({
      reason: { code: "IO_OUTPUT_EXISTS" },
    });
    expect(["first", "second"]).toContain(await readFile(path, "utf8"));
    expect(await readdir(root)).toEqual(["result.quizpack"]);
  });
  it("cancellation and IO failure do not leave artifacts or leak path", async () => {
    const root = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      writeArchiveNoClobber(
        join(root, "x.zip"),
        Buffer.from("x"),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "OPERATION_CANCELLED" });
    expect(await readdir(root)).toEqual([]);
    await expect(
      readLocalFile(join(root, "private-secret"), 1, signal()),
    ).rejects.toMatchObject({
      code: "IO_INPUT_FAILED",
      message: "QuizPack operation rejected.",
    });
  });
  it("preserves duplicate-key rejection, UTF8 validity and lowered depth", () => {
    expect(() => parsePackJson(Buffer.from('{"x":1,"x":2}'), 32)).toThrow(
      expect.objectContaining({ code: "JSON_DUPLICATE_KEY" }),
    );
    expect(() => parsePackJson(Buffer.from([0xff]), 32)).toThrow(
      expect.objectContaining({ code: "JSON_ENCODING" }),
    );
    expect(() => parsePackJson(Buffer.from('{"x":{}}'), 1)).toThrow(
      expect.objectContaining({ code: "JSON_DEPTH_LIMIT" }),
    );
    expect(canonicalPackJson({ b: [2, 1], a: true })).toBe(
      '{"a":true,"b":[2,1]}',
    );
  });
});
