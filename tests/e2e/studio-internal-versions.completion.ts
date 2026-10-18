/** Each specified case must actually pass once in this worker. Expected failure, skip,
 * retry, nonzero repeat indices, unknown/duplicate cases and filtered subsets cannot seal the fixture.
 */
export class InternalSuiteCompletion {
  private passed = new Set<string>();
  private invalid = false;
  constructor(private readonly titles: readonly string[]) {
    if (titles.length !== 6 || new Set(titles).size !== 6)
      throw Error("INTERNAL_VERSION_E2E_CASE_SET_INVALID");
  }
  observe(info: {
    title: string;
    status?: string;
    expectedStatus: string;
    retry: number;
    repeatEachIndex: number;
  }) {
    if (
      info.status !== "passed" ||
      info.expectedStatus !== "passed" ||
      info.retry !== 0 ||
      info.repeatEachIndex !== 0 ||
      !this.titles.includes(info.title) ||
      this.passed.has(info.title)
    )
      this.invalid = true;
    else this.passed.add(info.title);
  }
  canFinish() {
    return (
      !this.invalid &&
      this.passed.size === 6 &&
      this.titles.every((title) => this.passed.has(title))
    );
  }
}
