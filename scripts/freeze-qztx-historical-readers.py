"""Freeze only the two reviewed QZTX report/export profiles from exact Git objects.

No running tree, database, answers, or external source is read. Adapted paths have
their own hashes; an old renderer hash is never claimed as this new code's hash.
"""
import argparse
import hashlib
import json
import posixpath
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
THEME = "src/features/theme/qianzai-tongxin/"
REPORT = "src/features/report/qianzai-tongxin/"
PROFILES = [
    ("v13", "6540d7b05152dc5e57174e68d52ffa510847d3ff", "9732bdfd555a05ceb412ee8c8918fa9a8b076b6acff38a6035a08dd4bb4aadbe"),
    ("v14", "1f2177bcd15e47c1ec4120f324eccce9608489e0", "b88be4dd0e187169edf7f88f789e6b23685b7a795a792dd74936a6fa998b4809"),
]
IMPORT = re.compile(r"((?:from\s+|import\s*)[\"'])([^\"']+)([\"'])")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git_bytes(commit, path):
    return subprocess.check_output(["git", "show", f"{commit}:{path}"], cwd=ROOT)


def mapped(path, profile):
    for prefix in (THEME, REPORT):
        if path.startswith(prefix):
            return prefix + "historical-" + profile + "/" + path[len(prefix):]
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    records = []
    outputs = {}
    for profile, commit, renderer_sha in PROFILES:
        git_paths = set(subprocess.check_output(["git", "ls-tree", "-r", "--name-only", commit], cwd=ROOT, text=True).splitlines())
        entry = json.loads(git_bytes(commit, "src/features/product/internal-versions/implementation-data/d3-runtime-bindings.json"))["qianzaiConsumer"]
        assert entry["entrySha256"] == renderer_sha
        entry_path = "src/features/product/internal-play/implementation-data/consumer-qianzai-historical-" + profile + ".json"
        outputs[entry_path] = (json.dumps(entry, ensure_ascii=False, indent=2) + "\n").encode()
        pending = [THEME + name for name in ("report.tsx", "export-context.tsx", "font-owner.ts", "resource-owner.ts", "runtime-inputs.ts", "editorial-fonts.ts", "typography.module.css")]
        seen = set()
        profile_files = []
        while pending:
            source = pending.pop()
            if source in seen:
                continue
            seen.add(source)
            assert source.startswith((THEME, REPORT))
            assert Path(source).name not in ("views.tsx", "experience.tsx", "runtime.tsx", "projection.ts", "fixed-preview.tsx")
            original = git_bytes(commit, source)
            target = mapped(source, profile)
            data = original
            transforms = []
            if source.endswith(".ts") or source.endswith(".tsx"):
                text = original.decode()
                if source == THEME + "report.tsx":
                    text = text.replace('import type { QianzaiViewProps } from "./views";', 'import type { ConsumerViewPropsV2 } from "@/features/theme/consumer-v2/interfaces";\nimport type { QianzaiVisualProps } from "./art";\ntype QianzaiViewProps = ConsumerViewPropsV2 & QianzaiVisualProps;')
                    # This standalone reader returns to access, never an old quiz/reveal host.
                    text = text.replace('aria-label="返回人物揭晓"', 'aria-label="返回访问入口"')
                    transforms.append("Replace quiz-view type import with pure ports; report back control returns to access.")

                def rewrite(match):
                    specifier = match.group(2)
                    if specifier.startswith("@/"):
                        resolved = "src/" + specifier[2:]
                    elif specifier.startswith("."):
                        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source), specifier))
                    else:
                        return match.group(0)
                    local = resolved.startswith((THEME, REPORT))
                    if local:
                        found = None
                        for candidate in (resolved, resolved + ".ts", resolved + ".tsx", resolved + ".json"):
                            if candidate in git_paths:
                                found = candidate
                                break
                        if found is None:
                            raise RuntimeError("HISTORICAL_IMPORT_MISSING:" + resolved)
                        pending.append(found)
                    if resolved.endswith(".css"):
                        rewritten = posixpath.relpath(mapped(resolved, profile), posixpath.dirname(target))
                        if not rewritten.startswith("."):
                            rewritten = "./" + rewritten
                    else:
                        rewritten = "@/" + mapped(resolved, profile)[4:]
                    return match.group(1) + rewritten + match.group(3)

                text = IMPORT.sub(rewrite, text)
                data = text.encode()
                transforms.append("Rewrite local report/theme imports to this fixed profile; external relative imports become absolute aliases.")
            outputs[target] = data
            profile_files.append({"sourcePath": source, "sourceSha256": digest(original), "sourceBytes": len(original), "path": target, "sha256": digest(data), "bytes": len(data), "adaptations": transforms})
        records.append({"profile": profile, "sourceCommit": commit, "sourceRendererEntrySha256": renderer_sha, "originalEntryPath": entry_path, "files": sorted(profile_files, key=lambda x: x["path"])})
    # Use the repository's pinned formatter, then hash the actual adapted bytes.
    formatted = subprocess.check_output(
        ["node", "--input-type=module", "-e", "import prettier from 'prettier';let s='';for await(const b of process.stdin)s+=b;const out={};for(const [filepath,text] of Object.entries(JSON.parse(s)))out[filepath]=await prettier.format(text,{filepath});process.stdout.write(JSON.stringify(out));"],
        input=json.dumps({path: data.decode() for path, data in outputs.items()}).encode(), cwd=ROOT,
    )
    outputs = {path: text.encode() for path, text in json.loads(formatted).items()}
    for record in records:
        for row in record["files"]:
            row["sha256"] = digest(outputs[row["path"]])
            row["bytes"] = len(outputs[row["path"]])
    provenance = {"scope": "Two finite report/export readers only; original renderer identity is snapshot provenance, adapted code has independent hashes; no source admission or write availability.", "profiles": records}
    outputs[THEME + "historical-provenance.json"] = (json.dumps(provenance, ensure_ascii=False, indent=2) + "\n").encode()
    for relative, data in outputs.items():
        target = ROOT / relative
        if args.check:
            if target.read_bytes() != data:
                raise RuntimeError("HISTORICAL_FROZEN_FILE_CHANGED:" + relative)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    print(json.dumps({"status": "PASS_EXACT_HISTORICAL_PROVENANCE" if args.check else "CREATED_FROZEN_REPORT_PROFILES", "profiles": len(records), "files": len(outputs), "writeAvailability": False}))


if __name__ == "__main__":
    main()
