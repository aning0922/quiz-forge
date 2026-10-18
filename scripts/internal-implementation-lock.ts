/** Exact pnpm v9 text spans, not a general YAML parser. Ambiguous/duplicate structures are rejected. */
export type LockSection = "packages" | "snapshots";
export type ImporterSection = "dependencies" | "devDependencies";
export function readImplementationLock(text: string) {
  if (text.includes("\r") || !/^lockfileVersion: '9\.0'\n/.test(text))
    throw Error("IMPLEMENTATION_LOCK_FORMAT");
  const lines = text.split("\n");
  const top = new Map<string, { start: number; end: number }>();
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z][A-Za-z0-9]*):(?: .*|)$/.exec(lines[i]!);
    if (!match) {
      if (
        lines[i]!.trim() &&
        !lines[i]!.startsWith(" ") &&
        !lines[i]!.startsWith("#")
      )
        throw Error("IMPLEMENTATION_LOCK_TOP_LEVEL_FORMAT");
      continue;
    }
    if (top.has(match[1]!))
      throw Error("IMPLEMENTATION_LOCK_DUPLICATE_SECTION");
    const previous = [...top.values()].at(-1);
    if (previous) previous.end = i;
    top.set(match[1]!, { start: i, end: lines.length });
  }
  function label(line: string, indent: number): string | null {
    const prefix = " ".repeat(indent);
    if (!line.startsWith(prefix) || line[indent] === " ") return null;
    const content = line.slice(indent),
      match = /^('(?:[^']|'')*'|[^'\s:][^:]*):(?:\s.*)?$/.exec(content);
    if (!match) throw Error("IMPLEMENTATION_LOCK_KEY_FORMAT");
    const raw = match[1]!;
    const decoded = raw.startsWith("'")
      ? raw.slice(1, -1).replaceAll("''", "'")
      : raw;
    if (!/^[A-Za-z0-9@._/()+,=-]+(?![\s\S])/.test(decoded))
      throw Error("IMPLEMENTATION_LOCK_KEY_FORMAT");
    return decoded;
  }
  function blocks(start: number, end: number, indent: number) {
    const found = new Map<string, { start: number; end: number }>();
    for (let i = start; i < end; i++) {
      if (!lines[i]!.trim()) continue;
      const key = label(lines[i]!, indent);
      if (key === null) continue;
      if (found.has(key)) throw Error("IMPLEMENTATION_LOCK_DUPLICATE_KEY");
      const previous = [...found.values()].at(-1);
      if (previous) previous.end = i;
      found.set(key, { start: i, end });
    }
    return found;
  }
  const raw = (span: { start: number; end: number }) =>
    lines.slice(span.start, span.end).join("\n") + "\n";
  const sections = new Map<
    LockSection,
    Map<string, { start: number; end: number }>
  >();
  for (const name of ["packages", "snapshots"] as const) {
    const span = top.get(name);
    if (!span) throw Error("IMPLEMENTATION_LOCK_SECTION_MISSING");
    sections.set(name, blocks(span.start + 1, span.end, 2));
  }
  const importerTop = top.get("importers");
  if (!importerTop) throw Error("IMPLEMENTATION_IMPORTER_MISSING");
  const importers = blocks(importerTop.start + 1, importerTop.end, 2),
    root = importers.get(".");
  if (!root) throw Error("IMPLEMENTATION_ROOT_IMPORTER_MISSING");
  const scopes = blocks(root.start + 1, root.end, 4),
    direct = new Map<
      ImporterSection,
      Map<string, { start: number; end: number }>
    >();
  for (const section of ["dependencies", "devDependencies"] as const) {
    const span = scopes.get(section);
    if (!span) throw Error("IMPLEMENTATION_IMPORTER_SECTION_MISSING");
    direct.set(section, blocks(span.start + 1, span.end, 6));
  }
  return {
    settings() {
      const span = top.get("settings");
      if (!span) throw Error("IMPLEMENTATION_LOCK_SETTINGS_MISSING");
      return raw(span);
    },
    record(section: LockSection, key: string) {
      const span = sections.get(section)?.get(key);
      if (!span) throw Error("IMPLEMENTATION_LOCK_RECORD_MISSING");
      return raw(span);
    },
    importer(section: ImporterSection, name: string) {
      const span = direct.get(section)?.get(name);
      if (!span) throw Error("IMPLEMENTATION_IMPORTER_RECORD_MISSING");
      const value = raw(span);
      // Selected root dependency entries must be exactly two scalar fields with no duplicate/alternative meaning.
      const members = value
        .split("\n")
        .filter((line) => line.trim())
        .slice(1);
      if (
        members.length !== 2 ||
        !/^        specifier: [^\r\n]+$/.test(members[0]!) ||
        !/^        version: [^\r\n]+$/.test(members[1]!)
      )
        throw Error("IMPLEMENTATION_IMPORTER_AMBIGUOUS");
      return value;
    },
  };
}
