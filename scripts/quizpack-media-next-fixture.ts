import { createHash } from "node:crypto";
import { constants, writeSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  opendir,
  rmdir,
  unlink,
} from "node:fs/promises";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { createSyntheticFixture } from "../src/features/quizpack/v1/fixtures/synthetic";
import { createStoredArchive } from "../src/features/quizpack/v1/build";
import { canonicalPackJson } from "../src/features/quizpack/v1/io";
import {
  buildMediaDeployment,
  hardenMediaDeploymentArtifacts,
  verifyMediaDeployment,
} from "../src/lib/build/media-deployment";

// This disposable fixture has one fixed location, one loopback port, and no seal
// provisioning. Its synthetic inputs never come from HTTP or private runtime data.
const FIXTURE = ".cache/quizpack-media-next-fixture";
const PORT = 3111;
const MAX_GENERATED = 2 * 1024 * 1024;
const CASES = [
  "dimensions",
  "archetype",
  "wrong-product",
  "authored",
  "unknown-schema",
  "bad-zip",
  "bad-json",
  "bad-media",
  "missing-seal",
  "cancelled",
  "expired",
] as const;
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
class FixtureFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function fail(code: string): never {
  throw new FixtureFailure(code);
}
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function deadlineCheck(deadline: number) {
  if (performance.now() >= deadline) fail("FIXTURE_DEADLINE");
}
async function owned(target: string, directory: boolean) {
  const stat = await lstat(target);
  if (
    stat.uid !== process.getuid?.() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o7022) !== 0 ||
    (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
  )
    fail("FIXTURE_UNSAFE");
  return stat;
}
async function ownedDirectory(target: string) {
  try {
    await mkdir(target, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await owned(target, true);
}
async function fixedRead(target: string, max: number) {
  const before = await owned(target, false);
  if (before.size > max) fail("FIXTURE_SIZE_LIMIT");
  const fd = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await fd.stat();
    if (
      stat.ino !== before.ino ||
      stat.dev !== before.dev ||
      stat.size !== before.size
    )
      fail("FIXTURE_CHANGED");
    const bytes = await fd.readFile();
    const after = await fd.stat();
    if (
      bytes.length > max ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs
    )
      fail("FIXTURE_CHANGED");
    return bytes;
  } finally {
    await fd.close();
  }
}
async function writeGenerated(root: string, relative: string, value: string) {
  if (Buffer.byteLength(value) > MAX_GENERATED) fail("FIXTURE_SIZE_LIMIT");
  const target = path.join(root, relative);
  try {
    await owned(target, false);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = target + ".prepare-tmp";
  const fd = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await fd.writeFile(value);
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(temporary, target);
}
async function marker(checkout: string, fixture: string) {
  await owned(fixture, true);
  const bytes = await fixedRead(
    path.join(fixture, "fixture-marker.json"),
    1024,
  );
  if (
    bytes.toString() !==
    JSON.stringify({
      schema: "quizpack-next-fixture.v1",
      checkoutHash: hash(checkout),
    })
  )
    fail("FIXTURE_MARKER_INVALID");
}
async function cleanPreviousBuild(fixture: string, deadline: number) {
  let count = 0;
  let bytes = 0;
  const remove = async (target: string, depth: number): Promise<void> => {
    deadlineCheck(deadline);
    const stat = await lstat(target);
    if (stat.uid !== process.getuid?.() || ++count > 16384 || depth > 16)
      fail("FIXTURE_CLEAN_UNSAFE");
    if (stat.isSymbolicLink()) {
      await unlink(target);
      return;
    }
    if (stat.isFile()) {
      if (
        stat.nlink !== 1 ||
        stat.size > 16 * 1024 * 1024 ||
        (bytes += stat.size) > 128 * 1024 * 1024
      )
        fail("FIXTURE_CLEAN_UNSAFE");
      await unlink(target);
      return;
    }
    if (!stat.isDirectory()) fail("FIXTURE_CLEAN_UNSAFE");
    const dir = await opendir(target, { bufferSize: 16 });
    try {
      for (;;) {
        const entry = await dir.read();
        if (!entry) break;
        await remove(path.join(target, entry.name), depth + 1);
      }
    } finally {
      await dir.close();
    }
    await rmdir(target);
  };
  try {
    await remove(path.join(fixture, ".next"), 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  deadlineCheck(deadline);
}
async function rootFiles(checkout: string) {
  const result: Record<string, string | null> = {};
  for (const name of ["tsconfig.json", "next-env.d.ts"]) {
    try {
      result[name] = hash(
        await fixedRead(path.join(checkout, name), 64 * 1024),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      result[name] = null;
    }
  }
  return JSON.stringify(result);
}

type Embedded = { archive: string; target: string };
type CaseExpectation = {
  archiveSha256: string;
  archiveBytes: number;
  resourceCount: number;
  resourceDigest: string | null;
};
type FixtureExpectations = {
  schema: "quizpack-next-expectations.v1";
  cases: Record<string, CaseExpectation>;
  image: { sha256: string; bytes: number };
};
// Git supplies names only; source bytes use the bounded no-follow reader.
async function sourceSnapshot(checkout: string) {
  const groups = [
    "src/features/quizpack/v1",
    "src/features/quizpack/server/media",
    "src/features/quizpack/server/validation",
    "src/lib/foundation-json.ts",
    "src/lib/build/media-deployment.ts",
    "package.json",
    "pnpm-lock.yaml",
    "next.config.ts",
  ];
  const git = (args: string[]) => {
    const r = spawnSync("/usr/bin/git", args, {
      cwd: checkout,
      timeout: 2000,
      maxBuffer: 512 * 1024,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.error || r.status !== 0) fail("FIXTURE_SOURCE_SNAPSHOT_FAILED");
    return r.stdout;
  };
  const head = git(["rev-parse", "HEAD"]).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) fail("FIXTURE_SOURCE_SNAPSHOT_FAILED");
  const names = [
    ...new Set(
      (
        git(["ls-files", "-z", "--", ...groups]) +
        git([
          "ls-files",
          "-z",
          "--others",
          "--exclude-standard",
          "--",
          ...groups,
        ])
      )
        .split("\0")
        .filter(Boolean),
    ),
  ]
    .filter((name) => !/\.(test|d)\.ts$/.test(name))
    .sort();
  if (names.length > 4096) fail("FIXTURE_SOURCE_SNAPSHOT_FAILED");
  const digest = createHash("sha256").update(head);
  let total = 0;
  for (const name of names) {
    if (
      path.isAbsolute(name) ||
      name.split("/").some((p) => !p || p === "." || p === "..")
    )
      fail("FIXTURE_SOURCE_SNAPSHOT_FAILED");
    const bytes = await fixedRead(path.join(checkout, name), 16 * 1024 * 1024);
    total += bytes.length;
    if (total > 128 * 1024 * 1024) fail("FIXTURE_SOURCE_SNAPSHOT_FAILED");
    digest.update(JSON.stringify([name, bytes.length, hash(bytes)]));
  }
  return { head, digest: digest.digest("hex") };
}
async function generateCases(deadline: number) {
  const cases: Record<string, Embedded> = {};
  const expectations = {} as FixtureExpectations;
  expectations.schema = "quizpack-next-expectations.v1";
  expectations.cases = {};
  let image: { bytes: string; declaration: unknown } | undefined;
  for (const engine of ["dimensions", "archetype"] as const) {
    deadlineCheck(deadline);
    const fixture = await createSyntheticFixture(engine);
    deadlineCheck(deadline);
    const pack = async (
      change?: "authored" | "unknown-schema" | "bad-json" | "bad-media",
    ) => {
      const content = JSON.parse(canonicalPackJson(fixture.content));
      const manifest = JSON.parse(canonicalPackJson(fixture.manifest));
      const assets = fixture.assets.map((a) => ({
        path: a.path,
        bytes: Buffer.from(a.bytes),
      }));
      if (change === "authored") content.kind = "authored";
      if (change === "unknown-schema")
        manifest.schemaVersion = "quizpack.future";
      if (change === "bad-media") {
        assets[0]!.bytes = Buffer.from("invalid-synthetic-image");
        content.resources[0].bytes = assets[0]!.bytes.length;
        content.resources[0].sha256 = hash(assets[0]!.bytes);
        const entry = manifest.files.find(
          (f: { path: string }) => f.path === assets[0]!.path,
        );
        entry.bytes = assets[0]!.bytes.length;
        entry.sha256 = hash(assets[0]!.bytes);
      }
      const contentBytes = Buffer.from(
        change === "bad-json" ? "{invalid" : canonicalPackJson(content),
      );
      const entry = manifest.files.find(
        (f: { path: string }) => f.path === "content.json",
      );
      entry.bytes = contentBytes.length;
      entry.sha256 = hash(contentBytes);
      const signal = AbortSignal.timeout(
        Math.max(1, Math.ceil(deadline - performance.now())),
      );
      const archive = await createStoredArchive(
        [
          {
            path: "manifest.json",
            bytes: Buffer.from(canonicalPackJson(manifest)),
          },
          { path: "content.json", bytes: contentBytes },
          ...assets,
        ],
        MAX_GENERATED,
        signal,
      );
      deadlineCheck(deadline);
      const embedded = {
        archive: archive.toString("base64"),
        target: fixture.manifest.productId,
      };
      const key = change ?? engine;
      const rows = [...content.resources]
        .sort((a: { id: string }, b: { id: string }) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        )
        .map((r: { path: string; productId: string }) => {
          const actual = assets.find((a) => a.path === r.path)!.bytes;
          return [hash(actual), actual.length, hash(r.productId)];
        });
      expectations.cases[key] = {
        archiveSha256: hash(archive),
        archiveBytes: archive.length,
        resourceCount: assets.length,
        resourceDigest: hash(JSON.stringify(rows)),
      };
      return embedded;
    };
    cases[engine] = await pack();
    if (engine === "archetype") {
      for (const change of [
        "authored",
        "unknown-schema",
        "bad-json",
        "bad-media",
      ] as const)
        cases[change] = await pack(change);
      cases["wrong-product"] = { ...cases[engine]!, target: "synthetic-other" };
      cases["bad-zip"] = {
        archive: Buffer.from("invalid-synthetic-zip").toString("base64"),
        target: fixture.manifest.productId,
      };
      for (const name of ["missing-seal", "cancelled", "expired"])
        cases[name] = cases[engine]!;
      for (const name of [
        "wrong-product",
        "missing-seal",
        "cancelled",
        "expired",
      ])
        expectations.cases[name] = expectations.cases[engine]!;
      expectations.cases["bad-zip"] = {
        archiveSha256: hash(Buffer.from(cases["bad-zip"]!.archive, "base64")),
        archiveBytes: Buffer.from(cases["bad-zip"]!.archive, "base64").length,
        resourceCount: 0,
        resourceDigest: null,
      };
      const resource = fixture.content.resources[0]!;
      image = {
        bytes: Buffer.from(fixture.assets[0]!.bytes).toString("base64"),
        declaration: {
          path: resource.path,
          mediaType: resource.mediaType,
          bytes: resource.bytes,
          sha256: resource.sha256,
          width: resource.width,
          height: resource.height,
        },
      };
      expectations.image = {
        sha256: hash(fixture.assets[0]!.bytes),
        bytes: fixture.assets[0]!.bytes.length,
      };
    }
  }
  return { cases, image, expectations };
}

function routeSource(expectedRootsHash: string) {
  return `import "server-only";
import {createHash} from "node:crypto";
import {validateArchiveCandidate,copyCandidateResourceBytes,strictP1ReportSchema,serializeSealedReport} from "@/features/quizpack/server/validation";
import {createMediaOperationContext,disposeMediaOperationContext,readMediaRuntimeBinding,runIsolatedImage,type ImageDeclaration} from "@/features/quizpack/server/media";
import {cases,image} from "../../fixture-data";
declare const __QUIZFORGE_MEDIA_CHECKOUT_ROOT__: string;
declare const __QUIZFORGE_MEDIA_DEPLOYMENT_ROOT__: string;
export const runtime="nodejs";
export const dynamic="force-dynamic";
const hash=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
export async function GET(request:Request){
  const query=new URL(request.url).searchParams;
  const name=query.get("case");
  if(query.size!==1||!name||(!["image","health","identity"].includes(name)&&!Object.hasOwn(cases,name)))
    return Response.json({ok:false,code:"FIXTURE_CASE_INVALID"},{status:400});
  const pinned=hash(JSON.stringify([__QUIZFORGE_MEDIA_CHECKOUT_ROOT__,__QUIZFORGE_MEDIA_DEPLOYMENT_ROOT__]))===${JSON.stringify(expectedRootsHash)};
  if(name==="health")return Response.json({ok:true,case:name,macrosPinned:pinned});
  const controller=new AbortController();
  const abort=()=>controller.abort();
  request.signal.addEventListener("abort",abort,{once:true});
  if(request.signal.aborted||name==="cancelled")controller.abort();
  const context=createMediaOperationContext({signal:controller.signal,deadlineMonotonicMs:performance.now()+(name==="expired"?-1:60000)});
  let settled=false;
  try{
    if(name==="identity"||name==="missing-seal"){
      const binding=await readMediaRuntimeBinding(context);
      settled=binding.outcome==="bound"||binding.code!=="STOP_UNCONFIRMED";
      if(name==="identity")return Response.json({ok:true,case:name,publicApiImported:true,macrosPinned:pinned,outcome:binding.outcome,...(binding.outcome==="bound"?binding.binding:{code:binding.code})});
      if(binding.outcome==="bound")return Response.json({ok:false,code:"FIXTURE_SEAL_PRESENT",macrosPinned:pinned});
      settled=false;
    }
    if(name==="image"){
      const result=await runIsolatedImage(Buffer.from(image.bytes,"base64"),image.declaration as ImageDeclaration,context);
      settled=result.stopped!=="unknown";
      const factsMatch=result.outcome==="decoded"&&result.facts.mediaDecoded===true&&result.facts.frames===1&&result.facts.width===image.declaration.width&&result.facts.height===image.declaration.height&&result.facts.mediaType===image.declaration.mediaType;
      return Response.json({ok:true,case:name,publicApiImported:true,macrosPinned:pinned,outcome:result.outcome,code:result.outcome==="failed"?result.code:null,stopped:result.stopped,profileId:result.profileId,factsMatch,inputSha256:hash(Buffer.from(image.bytes,"base64"))});
    }
    const entry=cases[name as keyof typeof cases];
    const result=await validateArchiveCandidate(Buffer.from(entry.archive,"base64"),entry.target,context);
    const e=result.evidence;
    settled=e.completion.relatedIo==="settled"&&e.completion.mediaStopped!=="unknown";
    const report=e.report.status==="sealed"?e.report.value:null;
    const reportValid=e.report.status==="sealed"&&strictP1ReportSchema.safeParse(e.report.value).success&&hash(serializeSealedReport(e.report))===e.report.sha256;
    const checksPassed=!!report&&Object.keys(report.checks).length===6&&Object.values(report.checks).every((value)=>value==="passed");
    const checksFailed=!!report&&Object.values(report.checks).some((value)=>value==="failed");
    const mediaDecoded=e.media.length>0&&e.media.every((item)=>item.result.outcome==="decoded"&&item.result.stopped==="confirmed");
    const profiles=[...new Set(e.media.map((item)=>item.result.profileId))];
    const mediaProfileId=profiles.length===1?profiles[0]:null;
    let resourcesCopied=false,resourceCount=0,resourceDigest:string|null=null,candidateSha256:string|null=null,assetSetSha256:string|null=null;
    if(result.outcome==="accepted"){
      const candidate=result.candidate;
      const facts=candidate.facts;
      resourceCount=facts.resources.length;
      const rows= facts.resources.map((resource,index)=>{
        const copy=copyCandidateResourceBytes(candidate,index);
        const blob=hash(copy);
        const originalLength=copy.length;
        if(copy.length)copy[0]=copy[0]!^255;
        const fresh=copyCandidateResourceBytes(candidate,index);
        const declaration=resource.declaration;
        const content=facts.content.resources.find((item)=>item.id===declaration.id&&item.version===declaration.version);
        const valid=blob===resource.blobSha256&&blob===declaration.sha256&&originalLength===resource.bytes&&originalLength===declaration.bytes&&hash(fresh)===blob&&declaration.productId===facts.productId&&facts.productId===entry.target&&facts.content.product.productId===facts.productId&&facts.manifest.productId===facts.productId&&!!content&&content.path===declaration.path&&content.sha256===blob&&content.bytes===originalLength&&hash(resource.canonicalDeclarationText)===resource.declarationSha256;
        return {valid,row:[blob,originalLength,hash(declaration.productId)]};
      });
      resourcesCopied=rows.length>0&&rows.every((item)=>item.valid)&&facts.archiveSha256===(e.input.status==="snapshotted"?e.input.archiveSha256:null);
      resourceDigest=hash(JSON.stringify(rows.map((item)=>item.row)));
      candidateSha256=facts.candidateSha256;
      assetSetSha256=facts.assetSetSha256;
    }
    return Response.json({ok:true,case:name,publicApiImported:true,macrosPinned:pinned,outcome:result.outcome,code:result.outcome==="accepted"?null:result.code,candidatePresent:result.outcome==="accepted"&&!!result.candidate,candidateValid:report?.candidateValid??false,identity:e.identity.status,runtime:e.identity.status==="bound"?e.identity.value.runtime:null,report:e.report.status,reportValid,checksPassed,checksFailed,importable:report?.importable??null,publishable:report?.publishable??null,reportSha256:e.report.status==="sealed"?e.report.sha256:null,mediaCount:e.media.length,mediaDecoded,mediaNoUnknown:e.media.every((item)=>item.result.stopped!=="unknown"),mediaProfileId,completion:e.completion,archiveSha256:e.input.status==="snapshotted"?e.input.archiveSha256:null,resourcesCopied,resourceCount,resourceDigest,candidateSha256,assetSetSha256});
  }catch{return Response.json({ok:false,code:"FIXTURE_ROUTE_FAILED",macrosPinned:pinned},{status:500});}
  finally{if(settled){request.signal.removeEventListener("abort",abort);disposeMediaOperationContext(context);}}
}
`;
}

async function prepare(checkout: string, fixture: string, deadline: number) {
  await ownedDirectory(path.join(checkout, ".cache"));
  let exists = false;
  try {
    await lstat(fixture);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (exists) await marker(checkout, fixture);
  else {
    await ownedDirectory(fixture);
    await writeGenerated(
      fixture,
      "fixture-marker.json",
      JSON.stringify({
        schema: "quizpack-next-fixture.v1",
        checkoutHash: hash(checkout),
      }),
    );
  }
  for (const dir of ["app", "app/probe"])
    await ownedDirectory(path.join(fixture, dir));
  const embedded = await generateCases(deadline);
  const generated: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "quizpack-next-fixture",
      private: true,
      type: "module",
      dependencies: {
        next: "16.4.0",
        react: "19.3.0",
        "react-dom": "19.3.0",
        sharp: "0.35.5",
        zod: "4.6.5",
        "buffer-crc32": "1.0.0",
      },
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2017",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: false,
        skipLibCheck: true,
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "react-jsx",
        incremental: true,
        plugins: [{ name: "next" }],
        paths: { "@/*": ["../../src/*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    }),
    "next-env.d.ts":
      '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
    "next.config.mjs": `import {realpathSync} from "node:fs";\nimport {fileURLToPath} from "node:url";\nimport {join} from "node:path";\nconst checkout=realpathSync(fileURLToPath(new URL("../../",import.meta.url)));\nconst fixture=realpathSync(fileURLToPath(new URL("./",import.meta.url)));\nexport default {agentRules:false,turbopack:{root:checkout},outputFileTracingRoot:checkout,experimental:{cpus:1},compiler:{defineServer:{__QUIZFORGE_MEDIA_CHECKOUT_ROOT__:checkout,__QUIZFORGE_MEDIA_DEPLOYMENT_ROOT__:join(fixture,".next")}},outputFileTracingExcludes:{"/*":[join(checkout,".cache/**/*"),join(checkout,".env*"),join(checkout,"test-results/**/*"),join(checkout,"playwright-report/**/*")]}};\n`,
    "app/layout.tsx":
      "export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>;}\n",
    "app/page.tsx":
      "export default function Page(){return <p>Synthetic fixture only</p>;}\n",
    "fixture-data.ts": `export const cases=${JSON.stringify(embedded.cases)} as const;\nexport const image=${JSON.stringify(embedded.image)} as const;\n`,
    "expectations.json": JSON.stringify(embedded.expectations),
    "app/probe/route.ts": routeSource(
      hash(JSON.stringify([checkout, path.join(fixture, ".next")])),
    ),
  };
  let total = 0;
  for (const [relative, text] of Object.entries(generated)) {
    total += Buffer.byteLength(text);
    if (total > MAX_GENERATED) fail("FIXTURE_SIZE_LIMIT");
    await writeGenerated(fixture, relative, text);
    deadlineCheck(deadline);
  }
  return {
    generatedFiles: Object.keys(generated).length,
    generatedBytes: total,
    embeddedCases: Object.keys(embedded.cases).length,
  };
}

type OwnedChild = {
  child: ChildProcess;
  close: Promise<void>;
  stop: () => Promise<void>;
  failed: () => string | null;
};
async function launch(
  checkout: string,
  fixture: string,
  args: string[],
  logName: string,
  deadline: number,
): Promise<OwnedChild> {
  const require = createRequire(path.join(checkout, "package.json"));
  const cli = require.resolve("next/dist/bin/next");
  const logPath = path.join(fixture, logName);
  try {
    await owned(logPath, false);
    await unlink(logPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const log = await open(
    logPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  let code: string | null = null;
  let bytes = 0;
  let closed = false;
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: checkout,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: path.dirname(process.execPath) + ":/usr/bin:/bin",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  const signal = (value: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        code ??= "FIXTURE_STOP_FAILED";
    }
  };
  const groupAlive = () => {
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      code ??= "FIXTURE_STOP_FAILED";
      return true;
    }
  };
  const timer = setTimeout(
    () => {
      code ??= "FIXTURE_CHILD_DEADLINE";
      signal("SIGTERM");
    },
    Math.max(1, deadline - performance.now()),
  );
  const force = setTimeout(
    () => signal("SIGKILL"),
    Math.max(1, deadline - performance.now() + 2000),
  );
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 512 * 1024) {
        code ??= "FIXTURE_LOG_LIMIT";
        signal("SIGTERM");
        return;
      }
      try {
        writeSync(log.fd, chunk);
      } catch {
        code ??= "FIXTURE_LOG_FAILED";
        signal("SIGTERM");
      }
    });
  child.on("error", () => {
    code ??= "FIXTURE_CHILD_START_FAILED";
  });
  let finishTimer: NodeJS.Timeout;
  const close = new Promise<void>((resolve) => {
    finishTimer = setTimeout(
      () => {
        code = "FIXTURE_CLOSE_UNCONFIRMED";
        signal("SIGKILL");
        resolve();
      },
      Math.max(1, deadline - performance.now() + 5000),
    );
    child.once("close", (exit) => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(force);
      clearTimeout(finishTimer);
      if (exit !== 0) code ??= "FIXTURE_CHILD_FAILED";
      resolve();
    });
  });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    signal("SIGTERM");
    const end = performance.now() + 5000;
    while ((!closed || groupAlive()) && performance.now() < end) {
      if (performance.now() >= end - 3000) signal("SIGKILL");
      await delay(25);
    }
    if (!closed || groupAlive()) {
      code = "FIXTURE_CLOSE_UNCONFIRMED";
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
    // A detached process group is owned by this launch; do not leave descendants.
    signal("SIGKILL");
    clearTimeout(timer);
    clearTimeout(force);
    clearTimeout(finishTimer!);
    await log.close();
    if (!closed || groupAlive()) fail("FIXTURE_CLOSE_UNCONFIRMED");
    await close;
  };
  return { child, close, stop, failed: () => code };
}
function portFree() {
  const binary =
    process.platform === "darwin" ? "/usr/sbin/lsof" : "/usr/bin/lsof";
  const result = spawnSync(
    binary,
    ["-nP", "-iTCP:3111", "-sTCP:LISTEN", "-t"],
    {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error || (result.status !== 0 && result.status !== 1))
    fail("FIXTURE_PORT_CHECK_FAILED");
  return result.status === 1 && result.stdout.length === 0;
}
async function queryCase(
  name: string,
  deadline: number,
): Promise<Record<string, unknown>> {
  deadlineCheck(deadline);
  return new Promise((resolve, reject) => {
    const end = Math.min(deadline, performance.now() + 65000);
    const req = request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: `/probe?case=${name}`,
        agent: false,
        timeout: Math.min(65000, Math.max(1, deadline - performance.now())),
      },
      (response) => {
        let length = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 4096)
            req.destroy(new FixtureFailure("FIXTURE_RESPONSE_LIMIT"));
          else chunks.push(chunk);
        });
        response.on("error", () =>
          reject(new FixtureFailure("FIXTURE_RESPONSE_FAILED")),
        );
        response.on("end", () => {
          try {
            if (response.statusCode !== 200) fail("FIXTURE_RESPONSE_STATUS");
            const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
            if (!value || typeof value !== "object" || Array.isArray(value))
              fail("FIXTURE_RESPONSE_INVALID");
            resolve(value as Record<string, unknown>);
          } catch {
            reject(new FixtureFailure("FIXTURE_RESPONSE_INVALID"));
          }
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new FixtureFailure("FIXTURE_HTTP_DEADLINE")),
      Math.max(1, end - performance.now()),
    );
    req.on("timeout", () =>
      req.destroy(new FixtureFailure("FIXTURE_HTTP_DEADLINE")),
    );
    req.once("close", () => clearTimeout(timer));
    req.on("error", () =>
      reject(new FixtureFailure("FIXTURE_HTTP_UNAVAILABLE")),
    );
    req.end();
  });
}
function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function exact(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("FIXTURE_EXPECTATIONS_INVALID");
  return value as Record<string, unknown>;
}
async function readExpectations(fixture: string): Promise<FixtureExpectations> {
  const bytes = await fixedRead(
    path.join(fixture, "expectations.json"),
    64 * 1024,
  );
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
    if (JSON.stringify(value) !== text) fail("FIXTURE_EXPECTATIONS_INVALID");
  } catch {
    fail("FIXTURE_EXPECTATIONS_INVALID");
  }
  const root = exact(value, ["schema", "cases", "image"]);
  if (root.schema !== "quizpack-next-expectations.v1")
    fail("FIXTURE_EXPECTATIONS_INVALID");
  const cases = exact(root.cases, CASES);
  for (const name of CASES) {
    const item = exact(cases[name], [
      "archiveSha256",
      "archiveBytes",
      "resourceCount",
      "resourceDigest",
    ]);
    if (
      !isHash(item.archiveSha256) ||
      !Number.isSafeInteger(item.archiveBytes) ||
      (item.archiveBytes as number) < 1 ||
      (item.archiveBytes as number) > MAX_GENERATED ||
      item.resourceCount !== (name === "bad-zip" ? 0 : 4) ||
      (name === "bad-zip"
        ? item.resourceDigest !== null
        : !isHash(item.resourceDigest))
    )
      fail("FIXTURE_EXPECTATIONS_INVALID");
  }
  const image = exact(root.image, ["sha256", "bytes"]);
  if (
    !isHash(image.sha256) ||
    !Number.isSafeInteger(image.bytes) ||
    (image.bytes as number) < 1 ||
    (image.bytes as number) > MAX_GENERATED
  )
    fail("FIXTURE_EXPECTATIONS_INVALID");
  return value as FixtureExpectations;
}
function assertBase(result: Record<string, unknown>, name: string) {
  if (
    result.ok !== true ||
    result.case !== name ||
    result.publicApiImported !== true ||
    result.macrosPinned !== true
  )
    fail("FIXTURE_PUBLIC_ENTRY_ASSERTION");
}
function assertSettled(result: Record<string, unknown>) {
  const completion = result.completion as Record<string, unknown> | undefined;
  if (
    !completion ||
    !["not-started", "confirmed"].includes(completion.mediaStopped as string) ||
    completion.relatedIo !== "settled" ||
    completion.maintenanceRequired !== false ||
    result.mediaNoUnknown !== true ||
    !Number.isSafeInteger(result.mediaCount) ||
    (result.mediaCount as number) < 0 ||
    (result.mediaCount as number) > 64
  )
    fail("FIXTURE_SETTLE_ASSERTION");
}
async function verify(
  checkout: string,
  fixture: string,
  deadline: number,
  sealed: boolean,
) {
  const binding = await verifyMediaDeployment(
    { checkoutRoot: checkout, deploymentRoot: path.join(fixture, ".next") },
    { deadlineMonotonicMs: deadline },
  );
  if (!binding.ok) fail(binding.code);
  const expectations = await readExpectations(fixture);
  if (!portFree()) fail("FIXTURE_PORT_BUSY");
  const child = await launch(
    checkout,
    fixture,
    ["start", fixture, "--hostname", "127.0.0.1", "--port", "3111"],
    "start.log",
    deadline,
  );
  const observations: {
    case: string;
    outcome: string;
    code: string | null;
    mediaCount: number;
    archiveSha256?: string;
    resourceCount?: number;
  }[] = [];
  let runtime: Record<string, unknown> | null = null;
  let profileId: string | null = null;
  let stopped = false;
  try {
    const readyEnd = Math.min(deadline, performance.now() + 10000);
    let ready = false;
    while (performance.now() < readyEnd && !child.failed()) {
      try {
        const health = await queryCase("health", readyEnd);
        if (
          health.ok === true &&
          health.case === "health" &&
          health.macrosPinned === true
        ) {
          ready = true;
          break;
        }
      } catch {
        await delay(50);
      }
    }
    if (!ready) fail("FIXTURE_START_UNAVAILABLE");
    if (sealed) {
      const identity = await queryCase("identity", deadline);
      assertBase(identity, "identity");
      if (
        identity.outcome !== "bound" ||
        identity.schema !== "quizpack-media-runtime-binding.v1" ||
        identity.platform !== `${process.platform}-${process.arch}` ||
        identity.deploymentId !== binding.summary.deploymentId ||
        !isHash(identity.componentId) ||
        !isHash(identity.runtimeBundleHash) ||
        !isHash(identity.limitsHash)
      )
        fail("FIXTURE_RUNTIME_BINDING_ASSERTION");
      runtime = {
        schema: identity.schema,
        platform: identity.platform,
        componentId: identity.componentId,
        deploymentId: identity.deploymentId,
        runtimeBundleHash: identity.runtimeBundleHash,
        limitsHash: identity.limitsHash,
      };
      const image = await queryCase("image", deadline);
      assertBase(image, "image");
      if (
        image.outcome !== "decoded" ||
        image.stopped !== "confirmed" ||
        image.factsMatch !== true ||
        image.code !== null ||
        !isHash(image.profileId) ||
        image.inputSha256 !== expectations.image.sha256
      )
        fail("FIXTURE_IMAGE_ASSERTION");
      profileId = image.profileId;
      observations.push({
        case: "image",
        outcome: "decoded",
        code: null,
        mediaCount: 1,
      });
      for (const name of [
        "dimensions",
        "archetype",
        "wrong-product",
        "authored",
        "unknown-schema",
        "bad-zip",
        "bad-json",
        "bad-media",
      ] as const) {
        const result = await queryCase(name, deadline);
        assertBase(result, name);
        assertSettled(result);
        const expected = expectations.cases[name]!;
        const actualRuntime = result.runtime as Record<string, unknown> | null;
        if (
          result.identity !== "bound" ||
          !actualRuntime ||
          Object.keys(runtime).some(
            (key) => actualRuntime[key] !== runtime![key],
          ) ||
          result.archiveSha256 !== expected.archiveSha256
        )
          fail("FIXTURE_IDENTITY_INPUT_ASSERTION");
        if (name === "dimensions" || name === "archetype") {
          if (
            result.outcome !== "accepted" ||
            result.code !== null ||
            result.candidatePresent !== true ||
            result.candidateValid !== true ||
            result.report !== "sealed" ||
            result.reportValid !== true ||
            result.checksPassed !== true ||
            result.importable !== false ||
            result.publishable !== false ||
            !isHash(result.reportSha256) ||
            result.mediaDecoded !== true ||
            result.mediaCount !== expected.resourceCount ||
            result.mediaProfileId !== profileId ||
            result.resourcesCopied !== true ||
            result.resourceCount !== expected.resourceCount ||
            result.resourceDigest !== expected.resourceDigest ||
            !isHash(result.candidateSha256) ||
            !isHash(result.assetSetSha256) ||
            (result.completion as Record<string, unknown>).mediaStopped !==
              "confirmed"
          )
            fail("FIXTURE_ACCEPTED_ASSERTION");
        } else {
          const expectedCode =
            name === "wrong-product"
              ? "TARGET_PRODUCT_MISMATCH"
              : name === "authored"
                ? "AUTHORED_NOT_SUPPORTED"
                : name === "unknown-schema"
                  ? "UNSUPPORTED_MANIFEST_VERSION"
                  : "P1_REJECTED";
          if (
            result.outcome !== "rejected" ||
            result.code !== expectedCode ||
            result.candidatePresent !== false ||
            result.candidateValid !== false
          )
            fail("FIXTURE_REJECTION_ASSERTION");
          if (
            expectedCode === "P1_REJECTED" &&
            (result.report !== "sealed" ||
              result.reportValid !== true ||
              result.checksFailed !== true ||
              result.importable !== false ||
              result.publishable !== false ||
              !isHash(result.reportSha256))
          )
            fail("FIXTURE_FAILED_REPORT_ASSERTION");
          if (expectedCode !== "P1_REJECTED" && result.report !== "not-run")
            fail("FIXTURE_POLICY_REPORT_ASSERTION");
        }
        observations.push({
          case: name,
          outcome: result.outcome as string,
          code: result.code as string | null,
          mediaCount: result.mediaCount as number,
          archiveSha256: expected.archiveSha256,
          resourceCount: result.resourceCount as number,
        });
      }
    }
    for (const [name, expected] of [
      ["missing-seal", "RUNTIME_IDENTITY_UNAVAILABLE"],
      ["cancelled", "OPERATION_CANCELLED"],
      ["expired", "OPERATION_TIMEOUT"],
    ] as const) {
      if (sealed && name === "missing-seal") continue;
      const result = await queryCase(name, deadline);
      assertBase(result, name);
      assertSettled(result);
      const completion = result.completion as
        Record<string, unknown> | undefined;
      if (
        result.ok !== true ||
        result.case !== name ||
        result.publicApiImported !== true ||
        result.macrosPinned !== true ||
        result.outcome !== "interrupted" ||
        result.code !== expected ||
        result.candidateValid !== false ||
        result.candidatePresent !== false ||
        result.archiveSha256 !== expectations.cases[name]!.archiveSha256 ||
        result.mediaCount !== 0 ||
        completion?.mediaStopped !== "not-started" ||
        completion.relatedIo !== "settled" ||
        completion.maintenanceRequired !== false
      )
        fail("FIXTURE_FAIL_CLOSED_ASSERTION");
      observations.push({
        case: name,
        outcome: "interrupted",
        code: expected,
        mediaCount: 0,
      });
    }
  } finally {
    await child.stop();
    stopped = portFree();
    if (!stopped) fail("FIXTURE_PORT_CLOSE_UNCONFIRMED");
  }
  return {
    binding: binding.summary,
    runtime,
    profileId,
    publicImportsExecuted: true,
    macrosPinned: true,
    childClosed: true,
    portClosed: stopped,
    observations,
  };
}

async function main() {
  if (
    process.argv.length !== 3 ||
    !["prepare", "build", "verify", "verify-sealed"].includes(process.argv[2]!)
  )
    fail("FIXTURE_ARGUMENT_INVALID");
  if (process.version !== "v20.20.1") fail("FIXTURE_NODE_VERSION_UNSUPPORTED");
  const checkout = await realpath(process.cwd());
  const fixture = path.join(checkout, FIXTURE);
  const require = createRequire(path.join(checkout, "package.json"));
  if (
    require("next/package.json").version !== "16.4.0" ||
    require("react/package.json").version !== "19.3.0"
  )
    fail("FIXTURE_DEPENDENCY_VERSION_UNSUPPORTED");
  await owned(checkout, true);
  const before = await rootFiles(checkout);
  const mode = process.argv[2]!;
  const deadline =
    performance.now() +
    (mode === "build" ? 180000 : mode === "verify-sealed" ? 240000 : 60000);
  let evidence: unknown;
  try {
    if (mode === "prepare")
      evidence = await prepare(checkout, fixture, deadline);
    else {
      await owned(path.join(checkout, ".cache"), true);
      await marker(checkout, fixture);
      if (mode === "build") {
        const sourceBefore = await sourceSnapshot(checkout);
        await cleanPreviousBuild(fixture, deadline);
        const child = await launch(
          checkout,
          fixture,
          ["build", fixture],
          "build.log",
          deadline,
        );
        try {
          await child.close;
          if (child.failed()) fail(child.failed()!);
        } finally {
          await child.stop();
        }
        const sourceAfter = await sourceSnapshot(checkout);
        if (sourceBefore.digest !== sourceAfter.digest)
          fail("FIXTURE_BUILD_SOURCE_CHANGED");
        const roots = {
          checkoutRoot: checkout,
          deploymentRoot: path.join(fixture, ".next"),
        };
        const context = { deadlineMonotonicMs: deadline };
        const hardening = await hardenMediaDeploymentArtifacts(roots, context);
        if (!hardening.ok) fail(hardening.code);
        const binding = await buildMediaDeployment(roots, context);
        if (!binding.ok) fail(binding.code);
        evidence = {
          binding: binding.summary,
          bindingCommitted: binding.committed,
          hardening: hardening.summary,
          sourceStable: true,
          buildHead: sourceBefore.head,
        };
      } else
        evidence = await verify(
          checkout,
          fixture,
          deadline,
          mode === "verify-sealed",
        );
    }
    deadlineCheck(deadline);
  } finally {
    if ((await rootFiles(checkout)) !== before)
      fail("FIXTURE_ROOT_CONFIG_CHANGED");
  }
  return { ok: true, mode, rootConfigUnchanged: true, evidence };
}
process.stdout.on("error", () => {
  process.exitCode = 1;
});
void main().then(
  (value) => process.stdout.write(JSON.stringify(value) + "\n"),
  (error: unknown) => {
    process.exitCode = 1;
    process.stdout.write(
      JSON.stringify({
        ok: false,
        code: error instanceof FixtureFailure ? error.code : "FIXTURE_FAILED",
      }) + "\n",
    );
  },
);
