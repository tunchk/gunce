/**
 * Bounded live provider-quality checks (not a CI gate unless LIVE_PLAN_EXTRACT=1).
 * Run: LIVE_PLAN_EXTRACT=1 npx vitest run tests/plan-extract.live.test.ts
 * Reports expected vs observed types/titles only — never logs source text or provider bodies.
 */
import { describe, expect, it } from "vitest";
import { createOpenAIPlanExtractProvider } from "@/lib/ai/openai-plan-extract";
import { sanitizePlanExtractDrafts } from "@/lib/plan-extract";

const enabled = process.env.LIVE_PLAN_EXTRACT === "1";
const hasKey = Boolean(process.env.OPENAI_API_KEY?.trim());

const DIARY = "2026-09-10";
const TZ = "Europe/Berlin";

const ACCEPTANCE =
  "Yarın Almanca kelime sınavım var. Bu akşam kelimelere çalışmam lazım. Basketbolda güzel bir pas verdim. Matematik ödevinin teslim tarihini bilmiyorum.";

type Expectation = {
  id: string;
  source: string;
  mustInclude: Array<"HOMEWORK" | "EXAM" | "COURSE" | "STUDY_STEP">;
  mustExclude?: Array<"HOMEWORK" | "EXAM" | "COURSE" | "STUDY_STEP">;
  forbidTitle?: RegExp;
  requireHomeworkDateUncertain?: boolean;
  /** When true, observed list must be empty after sanitization. */
  expectEmpty?: boolean;
};

const CASES: Expectation[] = [
  {
    id: "acceptance",
    source: ACCEPTANCE,
    mustInclude: ["EXAM", "STUDY_STEP", "HOMEWORK"],
    forbidTitle: /basket/i,
    requireHomeworkDateUncertain: true,
  },
  {
    id: "intended-study",
    source: "Bu akşam kelimelere çalışmam lazım.",
    mustInclude: ["STUDY_STEP"],
    mustExclude: ["HOMEWORK", "EXAM"],
  },
  {
    id: "past-completed",
    source: "Dün kelimelere çalıştım.",
    mustInclude: [],
    mustExclude: ["STUDY_STEP", "HOMEWORK", "EXAM"],
    expectEmpty: true,
  },
  {
    id: "negated",
    source: "Kelimelere çalışmam gerekmiyor.",
    mustInclude: [],
    mustExclude: ["STUDY_STEP"],
    expectEmpty: true,
  },
  {
    id: "third-person",
    source: "Arkadaşım bu akşam kelimelere çalışacak.",
    mustInclude: [],
    mustExclude: ["STUDY_STEP", "HOMEWORK", "EXAM"],
    expectEmpty: true,
  },
  {
    id: "exam-only",
    source: "Yarın sınavım var.",
    mustInclude: ["EXAM"],
    mustExclude: ["STUDY_STEP"],
  },
  {
    id: "homework-unknown-due",
    source: "Ödevim var ama teslim tarihini bilmiyorum.",
    mustInclude: ["HOMEWORK"],
    requireHomeworkDateUncertain: true,
  },
];

describe.runIf(enabled && hasKey)("Live plan extract quality (bounded)", () => {
  it("evaluates acceptance + contrasting fictional examples once each", async () => {
    const provider = createOpenAIPlanExtractProvider();
    expect(provider.isConfigured()).toBe(true);

    const report: Array<{
      id: string;
      expected: string[];
      observed: string[];
      titles: string[];
      ok: boolean;
      gaps: string[];
    }> = [];

    for (const c of CASES) {
      const raw = await provider.extract({
        sourceText: c.source,
        diaryDate: DIARY,
        timeZone: TZ,
      });
      const candidates = sanitizePlanExtractDrafts(raw.candidates, c.source, DIARY);
      const types = candidates.map((x) => x.type);
      const gaps: string[] = [];

      for (const t of c.mustInclude) {
        if (!types.includes(t)) gaps.push(`missing:${t}`);
      }
      for (const t of c.mustExclude ?? []) {
        if (types.includes(t)) gaps.push(`unexpected:${t}`);
      }
      if (c.expectEmpty && candidates.length > 0) {
        gaps.push(`expected-empty:got:${types.join(",")}`);
      }
      if (c.forbidTitle && candidates.some((x) => c.forbidTitle!.test(x.title))) {
        gaps.push("forbidden-title");
      }
      if (c.requireHomeworkDateUncertain) {
        const hw = candidates.find((x) => x.type === "HOMEWORK");
        if (!hw) gaps.push("missing:HOMEWORK");
        else if (!hw.dateUncertain) gaps.push("homework-date-should-be-uncertain");
      }

      report.push({
        id: c.id,
        expected: c.mustInclude,
        observed: types,
        titles: candidates.map((x) => x.title),
        ok: gaps.length === 0,
        gaps,
      });
    }

    // eslint-disable-next-line no-console
    console.log("LIVE_EXTRACT_EVAL", JSON.stringify({ cases: report }));

    const failed = report.filter((r) => !r.ok);
    expect(
      failed,
      failed.map((f) => `${f.id}:${f.gaps.join("|")}`).join("; ") || "ok",
    ).toEqual([]);
  }, 180_000);
});

describe.runIf(!enabled || !hasKey)("Live plan extract (skipped)", () => {
  it("marks live extraction as not tested when key/flag missing", () => {
    expect(true).toBe(true);
  });
});
