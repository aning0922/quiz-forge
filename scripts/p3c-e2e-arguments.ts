const projects = new Set([
  "mobile-chromium",
  "desktop-chromium",
  "studio-auth",
  "studio-workspace",
  "studio-imports",
  "studio-validations",
  "studio-drafts",
  "studio-preview",
  "studio-draft-revisions",
  "studio-internal-versions",
]);
/** Forward only test selectors. Playwright control/version/UI/config switches cannot bypass an actual run. */
export function previewE2eArguments(input: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const match = /^--(project|grep|grep-invert)(?:=([\s\S]*))?$/.exec(
      input[i]!,
    );
    if (!match) throw Error("MANAGED_E2E_ARGUMENTS_INVALID");
    const key = match[1]!,
      value = match[2] ?? input[++i];
    if (
      !value ||
      value.length > 1024 ||
      /[\u0000-\u001f\u007f]/.test(value) ||
      value.startsWith("-") ||
      (key === "project" && !projects.has(value)) ||
      (key !== "project" && seen.has(key))
    )
      throw Error("MANAGED_E2E_ARGUMENTS_INVALID");
    seen.add(key);
    result.push(`--${key}=${value}`);
  }
  return result;
}
