import { describe, expect, it } from "vitest";
import type { PlanExtractCandidateDraft } from "@/lib/ai/types";
import { PLAN_EXTRACT_SYSTEM_PROMPT } from "@/lib/ai/openai-plan-extract";
import { sanitizePlanExtractDrafts } from "@/lib/plan-extract";
import { excerptOccursInSource, resolvePlanExtractDate, studyStepExcerptIsGrounded } from "@/lib/plan-extract-dates";

const DIARY = "2026-09-10";

/** Fictional multi-clause acceptance narrative (same shape as product example). */
const ACCEPTANCE_FIXTURE =
  "Yarın Almanca kelime sınavım var. Bu akşam kelimelere çalışmam lazım. Basketbolda güzel bir pas verdim. Matematik ödevinin teslim tarihini bilmiyorum.";

describe("Plan extract sanitization (deterministic)", () => {
  it("keeps an explicit STUDY_STEP prep draft linked to an exam when excerpt matches", () => {
    const drafts: PlanExtractCandidateDraft[] = [
      {
        type: "EXAM",
        mentionKind: "EXPLICIT",
        title: "Almanca kelime sınavı",
        sourceExcerpt: "Yarın Almanca kelime sınavım var",
        datePhrase: "yarın",
        proposedDate: "2026-09-11",
        dateUncertain: false,
        relatedCandidateIndex: null,
      },
      {
        type: "STUDY_STEP",
        mentionKind: "PREPARATION",
        title: "Almanca kelimelerine çalış",
        sourceExcerpt: "Bu akşam kelimelere çalışmam lazım",
        datePhrase: "bu akşam",
        proposedDate: "2026-09-10",
        dateUncertain: false,
        relatedCandidateIndex: 0,
      },
      {
        type: "HOMEWORK",
        mentionKind: "EXPLICIT",
        title: "Matematik ödevi",
        sourceExcerpt: "Matematik ödevinin teslim tarihini bilmiyorum",
        datePhrase: "teslim tarihini bilmiyorum",
        proposedDate: null,
        dateUncertain: true,
        relatedCandidateIndex: null,
      },
    ];

    const out = sanitizePlanExtractDrafts(drafts, ACCEPTANCE_FIXTURE, DIARY);
    expect(out.map((c) => c.type)).toEqual(["EXAM", "STUDY_STEP", "HOMEWORK"]);
    expect(out[1]!.relatedCandidateOrdinal).toBe(0);
    expect(out[2]!.dateUncertain).toBe(true);
    expect(out[2]!.proposedDate).toBeNull();
  });

  it("drops drafts whose excerpt is not in the source (not lost silently as empty title)", () => {
    const drafts: PlanExtractCandidateDraft[] = [
      {
        type: "STUDY_STEP",
        mentionKind: "PREPARATION",
        title: "Uydurma adım",
        sourceExcerpt: "metinde olmayan alıntı",
        datePhrase: "bu akşam",
      },
    ];
    expect(sanitizePlanExtractDrafts(drafts, ACCEPTANCE_FIXTURE, DIARY)).toEqual([]);
  });

  it("does not invent candidates: empty provider list stays empty", () => {
    expect(sanitizePlanExtractDrafts([], ACCEPTANCE_FIXTURE, DIARY)).toEqual([]);
  });

  it("treats deadline uncertainty as dateUncertain without removing homework", () => {
    const source = "Ödevim var ama teslim tarihini bilmiyorum.";
    const drafts: PlanExtractCandidateDraft[] = [
      {
        type: "HOMEWORK",
        mentionKind: "EXPLICIT",
        title: "Ödev",
        sourceExcerpt: "Ödevim var ama teslim tarihini bilmiyorum",
        datePhrase: "teslim tarihini bilmiyorum",
        proposedDate: null,
        dateUncertain: true,
      },
    ];
    const out = sanitizePlanExtractDrafts(drafts, source, DIARY);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("HOMEWORK");
    expect(out[0]!.dateUncertain).toBe(true);
  });

  it("resolves bu akşam against diary date for study steps", () => {
    const resolved = resolvePlanExtractDate({
      diaryDate: DIARY,
      datePhrase: "bu akşam",
    });
    expect(resolved.proposedDate).toBe(DIARY);
    expect(resolved.dateUncertain).toBe(false);
  });

  it("drops STUDY_STEP drafts whose excerpt lacks study intent (invented prep)", () => {
    const source = "Yarın sınavım var.";
    const drafts: PlanExtractCandidateDraft[] = [
      {
        type: "EXAM",
        mentionKind: "EXPLICIT",
        title: "Sınav",
        sourceExcerpt: "Yarın sınavım var",
        datePhrase: "yarın",
      },
      {
        type: "STUDY_STEP",
        mentionKind: "PREPARATION",
        title: "Çalışmalıyım",
        sourceExcerpt: "Yarın sınavım var",
        datePhrase: "yarın",
      },
    ];
    const out = sanitizePlanExtractDrafts(drafts, source, DIARY);
    expect(out.map((c) => c.type)).toEqual(["EXAM"]);
  });

  it("classifies study-intent excerpts for grounding", () => {
    expect(studyStepExcerptIsGrounded("Bu akşam kelimelere çalışmam lazım")).toBe(true);
    expect(studyStepExcerptIsGrounded("Yarın sınavım var")).toBe(false);
    expect(studyStepExcerptIsGrounded("Dün kelimelere çalıştım")).toBe(false);
    expect(studyStepExcerptIsGrounded("Kelimelere çalışmam gerekmiyor")).toBe(false);
  });

  it("drops HOMEWORK invented from a study-only excerpt", () => {
    const source = "Bu akşam kelimelere çalışmam lazım.";
    const drafts: PlanExtractCandidateDraft[] = [
      {
        type: "STUDY_STEP",
        mentionKind: "EXPLICIT",
        title: "Kelimelere çalış",
        sourceExcerpt: "Bu akşam kelimelere çalışmam lazım",
        datePhrase: "bu akşam",
      },
      {
        type: "HOMEWORK",
        mentionKind: "EXPLICIT",
        title: "Kelimeler ödevi",
        sourceExcerpt: "Bu akşam kelimelere çalışmam lazım",
      },
    ];
    expect(sanitizePlanExtractDrafts(drafts, source, DIARY).map((c) => c.type)).toEqual([
      "STUDY_STEP",
    ]);
  });
});

describe("Contrasting fixture expectations (provider-draft contracts)", () => {
  const cases: Array<{
    id: string;
    source: string;
    /** What a correct provider should return (not keyword-generated in production). */
    expectedTypes: Array<"HOMEWORK" | "EXAM" | "COURSE" | "STUDY_STEP">;
    drafts: PlanExtractCandidateDraft[];
  }> = [
    {
      id: "intended-study",
      source: "Bu akşam kelimelere çalışmam lazım.",
      expectedTypes: ["STUDY_STEP"],
      drafts: [
        {
          type: "STUDY_STEP",
          mentionKind: "EXPLICIT",
          title: "Kelimelere çalış",
          sourceExcerpt: "Bu akşam kelimelere çalışmam lazım",
          datePhrase: "bu akşam",
          proposedDate: DIARY,
        },
      ],
    },
    {
      id: "past-completed",
      source: "Dün kelimelere çalıştım.",
      expectedTypes: [],
      drafts: [],
    },
    {
      id: "negated",
      source: "Kelimelere çalışmam gerekmiyor.",
      expectedTypes: [],
      drafts: [],
    },
    {
      id: "third-person",
      source: "Arkadaşım bu akşam kelimelere çalışacak.",
      expectedTypes: [],
      drafts: [],
    },
    {
      id: "exam-only",
      source: "Yarın sınavım var.",
      expectedTypes: ["EXAM"],
      drafts: [
        {
          type: "EXAM",
          mentionKind: "EXPLICIT",
          title: "Sınav",
          sourceExcerpt: "Yarın sınavım var",
          datePhrase: "yarın",
          proposedDate: "2026-09-11",
        },
      ],
    },
    {
      id: "homework-unknown-due",
      source: "Ödevim var ama teslim tarihini bilmiyorum.",
      expectedTypes: ["HOMEWORK"],
      drafts: [
        {
          type: "HOMEWORK",
          mentionKind: "EXPLICIT",
          title: "Ödev",
          sourceExcerpt: "Ödevim var ama teslim tarihini bilmiyorum",
          datePhrase: "teslim tarihini bilmiyorum",
          dateUncertain: true,
        },
      ],
    },
  ];

  for (const c of cases) {
    it(`${c.id}: sanitize preserves correct draft contract`, () => {
      const out = sanitizePlanExtractDrafts(c.drafts, c.source, DIARY);
      expect(out.map((x) => x.type)).toEqual(c.expectedTypes);
      // Wrongly invented prep must not appear when provider correctly returns none.
      if (c.id === "exam-only") {
        expect(out.every((x) => x.type !== "STUDY_STEP")).toBe(true);
      }
    });
  }
});
