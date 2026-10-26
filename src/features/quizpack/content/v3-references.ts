import type { V2Result } from "@/lib/assessment-contract/scoring-api-v2";
import { prepareScoringV2 } from "@/features/quiz/scoring/v2";
import {
  CONTENT_COMPONENTS_V3,
  CONTENT_COMPONENT_VERSION_V3,
  neutralSlotRefsV3,
  characterSlotRefsV3,
} from "@/lib/assessment-contract/presentation-v3";
import {
  failure,
  parseBounded,
  refKey,
} from "@/features/quiz/scoring/v2/boundary";
import {
  COMPOSED_VOLUME_IDS,
  contentCoreV3Schema,
  quizPackContentV3Schema,
  type ContentCoreV3,
  type QuizPackContentV3,
} from "./v3";
import { estimateContentReportBudgetV3 } from "./v3-budget";

const exact = (
  a: { id: string; productId: string; version: string }[],
  b: { id: string; productId: string; version: string }[],
) =>
  a.length === b.length &&
  new Set(a.map(refKey)).size === a.length &&
  a.every((r, i) => refKey(r) === refKey(b[i]!));
export function validateCoreV3(input: unknown): V2Result<ContentCoreV3> {
  const parsed = parseBounded(contentCoreV3Schema, input, "INVALID_CONTENT");
  if (!parsed.ok) return parsed;
  const c = parsed.value,
    d = c.scoringDefinition;
  const prepared = prepareScoringV2(d);
  if (!prepared.ok) return prepared;
  if (
    !exact(
      c.dimensions.map((v) => v.ref),
      d.dimensions.map((v) => v.ref),
    ) ||
    !exact(
      c.results.map((v) => v.ref),
      d.profiles.map((v) => v.resultRef),
    ) ||
    !exact(
      c.questions.map((v) => v.ref),
      d.questions.map((v) => v.ref),
    ) ||
    c.questions.some(
      (q, i) =>
        !exact(
          q.options.map((o) => o.ref),
          d.questions[i]!.options.map((o) => o.ref),
        ),
    )
  )
    return failure("REFERENCE_MISMATCH");
  const families = new Set<string>();
  for (const e of c.evidenceFamilies.entries) {
    const question = d.questions.find(
      (q) => refKey(q.ref) === refKey(e.questionRef),
    );
    const dim = d.dimensions.find(
      (v) => refKey(v.ref) === refKey(e.dimensionRef),
    );
    const key = JSON.stringify([refKey(e.questionRef), refKey(e.dimensionRef)]);
    if (
      !question ||
      !dim ||
      families.has(key) ||
      !question.options.some((o) =>
        o.contributions.some(
          (v) =>
            refKey(v.dimensionRef) === refKey(e.dimensionRef) && v.value !== 0,
        ),
      )
    )
      return failure("INVALID_REPORT_RULES");
    families.add(key);
  }
  // Every nonzero scoring edge has one explicit editorial family and core flag.
  for (const q of d.questions)
    for (const dim of d.dimensions)
      if (
        q.options.some((o) =>
          o.contributions.some(
            (v) => refKey(v.dimensionRef) === refKey(dim.ref) && v.value !== 0,
          ),
        ) &&
        !families.has(JSON.stringify([refKey(q.ref), refKey(dim.ref)]))
      )
        return failure("INVALID_REPORT_RULES");
  let act = 1;
  for (const q of c.questions) {
    if (q.act !== act && q.act !== act + 1)
      return failure("REFERENCE_MISMATCH");
    act = q.act;
  }
  if (
    c.questions[0]!.act !== 1 ||
    new Set(c.provenance.map((p) => p.kind)).size !== c.provenance.length ||
    !c.provenance.some((p) => p.kind === "questions") ||
    !c.provenance.some((p) => p.kind === "personas")
  )
    return failure("REFERENCE_MISMATCH");
  return parsed;
}
export function validateContentV3(input: unknown): V2Result<QuizPackContentV3> {
  const parsed = parseBounded(
    quizPackContentV3Schema,
    input,
    "INVALID_CONTENT",
  );
  if (!parsed.ok) return parsed;
  const { core: c, bindings: b } = parsed.value;
  const core = validateCoreV3(c);
  if (!core.ok) return core;
  const pid = c.scoringDefinition.productId;
  const resources = new Map(b.resources.map((r) => [refKey(r), r]));
  const results = new Set(c.results.map((r) => refKey(r.ref)));
  const templates = new Set(b.reportTemplates.map((r) => refKey(r.ref)));
  const fullSet = (values: string[], expected: Set<string>) =>
    values.length === expected.size &&
    new Set(values).size === expected.size &&
    values.every((v) => expected.has(v));
  if (
    resources.size !== b.resources.length ||
    templates.size !== b.reportTemplates.length ||
    new Set(b.reportTemplates.map((t) => t.ref.id)).size !==
      b.reportTemplates.length ||
    !fullSet(
      b.resultReports.map((r) => refKey(r.resultRef)),
      results,
    ) ||
    !fullSet(
      b.slots.characters.map((r) => refKey(r.resultRef)),
      results,
    ) ||
    b.resultReports.some((r) => !templates.has(refKey(r.templateRef))) ||
    b.slots.characters.some(
      (r) =>
        [r.reveal, r.report, r.poster].some(
          (v) => resources.get(refKey(v))?.purpose !== "portrait",
        ) || resources.get(refKey(r.nameArt))?.purpose !== "decoration",
    ) ||
    b.resources.some((r) => r.productId !== pid) ||
    b.reportTemplates.some((t) => t.ref.productId !== pid) ||
    Object.values(b.layouts).some((l) =>
      l.resourceRefs.some((r) => !resources.has(refKey(r))),
    )
  )
    return failure("REFERENCE_MISMATCH");
  const vp = b.visualPresentation;
  const neutralRefs = neutralSlotRefsV3(b.slots),
    neutral = new Set(neutralRefs.map(refKey));
  const owners = new Map<string, string>();
  for (const character of b.slots.characters)
    for (const r of characterSlotRefsV3(character)) {
      const key = refKey(r),
        owner = refKey(character.resultRef);
      if (neutral.has(key) || (owners.has(key) && owners.get(key) !== owner))
        return failure("REFERENCE_MISMATCH");
      owners.set(key, owner);
    }
  if (
    neutralRefs.some((r) => {
      const p = resources.get(refKey(r))?.purpose;
      return p !== "cover" && p !== "decoration";
    }) ||
    resources.size !== new Set([...neutral, ...owners.keys()]).size ||
    refKey(b.slots.neutral.cover) !== refKey(vp.coverSceneRef) ||
    b.slots.neutral.acts.length !== vp.sections.length ||
    b.slots.neutral.acts.some(
      (a, i) =>
        a.sectionId !== vp.sections[i]!.id ||
        refKey(a.background) !== refKey(vp.sections[i]!.sceneRef),
    )
  )
    return failure("REFERENCE_MISMATCH");
  const scenes = new Map(vp.sections.map((s, i) => [s.id, i]));
  const scene = (r: typeof vp.coverSceneRef, purpose: string) =>
    resources.get(refKey(r))?.purpose === purpose;
  if (
    !scene(vp.coverSceneRef, "cover") ||
    scenes.size !== vp.sections.length ||
    vp.sections.some((s) => !scene(s.sceneRef, "decoration")) ||
    vp.questionFrames.length !== c.questions.length ||
    !fullSet(
      vp.resourceDescriptions.map((r) => refKey(r.resourceRef)),
      new Set(resources.keys()),
    )
  )
    return failure("REFERENCE_MISMATCH");
  let previous = -1;
  for (const [i, f] of vp.questionFrames.entries()) {
    const section = scenes.get(f.sectionId);
    if (
      refKey(f.questionRef) !== refKey(c.questions[i]!.ref) ||
      section === undefined ||
      section + 1 !== c.questions[i]!.act ||
      (section !== previous && section !== previous + 1) ||
      (f.sceneOverrideRef && !scene(f.sceneOverrideRef, "decoration"))
    )
      return failure("REFERENCE_MISMATCH");
    previous = section;
  }
  if (previous !== vp.sections.length - 1) return failure("REFERENCE_MISMATCH");
  const sceneRefs = b.slots.neutral.acts.flatMap((a) => [
    a.background,
    a.questionPaper,
    a.optionIdle,
    a.optionSelected,
  ]);
  const n = b.slots.neutral,
    seal = n.seal ? [n.seal] : [],
    paper = [n.reportPaper, ...(n.reportBorder ? [n.reportBorder] : [])];
  const graphs = {
    cover: [vp.coverSceneRef, ...seal],
    question: sceneRefs,
    resume: [vp.coverSceneRef, ...sceneRefs],
    result: [
      ...b.slots.characters.flatMap((p) => [p.reveal, p.nameArt]),
      ...seal,
    ],
    report: [
      ...paper,
      ...b.slots.characters.flatMap((p) => [p.report, p.nameArt]),
    ],
    poster: [
      ...paper,
      ...seal,
      ...b.slots.characters.flatMap((p) => [p.poster, p.nameArt]),
    ],
  };
  for (const state of Object.keys(graphs) as (keyof typeof graphs)[])
    if (
      b.layouts[state].component.id !== CONTENT_COMPONENTS_V3[state] ||
      b.layouts[state].component.version !== CONTENT_COMPONENT_VERSION_V3 ||
      b.layouts[state].component.propsSchemaVersion !== "1.0.0" ||
      !fullSet(
        b.layouts[state].resourceRefs.map(refKey),
        new Set(graphs[state].map(refKey)),
      )
    )
      return failure("REFERENCE_MISMATCH");
  const evidenceValid = (e: {
    questionRef: typeof vp.coverSceneRef;
    optionRef: typeof vp.coverSceneRef;
  }) =>
    c.questions.some(
      (q) =>
        refKey(q.ref) === refKey(e.questionRef) &&
        q.options.some((o) => refKey(o.ref) === refKey(e.optionRef)),
    );
  for (const t of b.reportTemplates) {
    const claims = new Set(t.claims.map((v) => refKey(v.ref)));
    if (
      claims.size !== t.claims.length ||
      new Set(t.claims.map((v) => v.ref.id)).size !== t.claims.length ||
      t.volumes.some(
        (v, i) =>
          v.id !== COMPOSED_VOLUME_IDS[i] ||
          new Set(v.claimRefs.map(refKey)).size !== v.claimRefs.length ||
          v.claimRefs.some((r) => !claims.has(refKey(r))),
      )
    )
      return failure("INVALID_REPORT_RULES");
    for (const claim of t.claims) {
      if (
        claim.ref.productId !== pid ||
        !c.dimensions.some(
          (d) => refKey(d.ref) === refKey(claim.dimensionRef),
        ) ||
        [
          ...claim.evidence,
          ...claim.counterevidence,
          ...claim.when.answers,
        ].some((e) => !evidenceValid(e)) ||
        new Set(
          [...claim.evidence, ...claim.counterevidence].map((e) =>
            refKey(e.questionRef),
          ),
        ).size !==
          claim.evidence.length + claim.counterevidence.length ||
        (claim.when.scoreRange &&
          claim.when.scoreRange.min > claim.when.scoreRange.max) ||
        (claim.when.selectedResultRef &&
          !results.has(refKey(claim.when.selectedResultRef))) ||
        (claim.kind === "context" && !claim.counterevidence.length) ||
        (claim.kind === "literary"
          ? !claim.literaryBridge ||
            !results.has(refKey(claim.literaryBridge.roleRef))
          : claim.literaryBridge !== null)
      )
        return failure("INVALID_REPORT_RULES");
    }
  }
  if (!estimateContentReportBudgetV3(parsed.value).ok)
    return failure("INPUT_LIMIT_EXCEEDED");
  return parsed;
}

/** This is offline structure/logic evidence, never ZIP/media/registry admission. */
export function inspectBuildInputV3(core: unknown, bindings: unknown = null) {
  const checked = validateCoreV3(core);
  const content =
    checked.ok && bindings !== null
      ? validateContentV3({
          schemaVersion: "quizpack-content.v3",
          core: checked.value,
          bindings,
        })
      : null;
  return {
    coreValid: checked.ok,
    contentValid: content?.ok === true,
    missingBindings:
      bindings === null
        ? [
            "report-templates",
            "character-slots",
            "resources",
            "layouts",
            "visual-presentation",
          ]
        : [],
    importable: false as const,
    issues: !checked.ok
      ? checked.issues
      : content && !content.ok
        ? content.issues
        : [],
  };
}
