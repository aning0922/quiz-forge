/** D0 proposal only. No report generation, persistence or AI request is implemented. */
export type ReportMode = "DETERMINISTIC" | "COMPOSED" | "AI_ENHANCED";

export interface ReportPolicy {
  mode: ReportMode;
  templateId: string;
  templateVersion: string;
  baselineTemplateId: string;
  baselineTemplateVersion: string;
}

// Proposed AI output contains prose only. Result identity and scores are outside this payload.
// A future strict runtime schema must reject additional fields and check content boundaries.
export interface AIReportProseDraft {
  schemaVersion: "report-prose.v1";
  sections: readonly { id: string; text: string }[];
}
