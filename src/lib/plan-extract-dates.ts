import { addCalendarDays, parseCalendarDate } from "@/lib/plan-dates";

const UNCERTAIN_MARKERS =
  /\b(galiba|belki|sanırım|sanirim|herhalde|bilmiyorum|emin değilim|emin degilim|olabilir|muhtemelen)\b/iu;

const WEEKDAY_TR: Record<string, number> = {
  pazar: 0,
  pazartesi: 1,
  salı: 2,
  sali: 2,
  çarşamba: 3,
  carsamba: 3,
  perşembe: 4,
  persembe: 4,
  cuma: 5,
  cumartesi: 6,
};

export type DateResolveResult = {
  proposedDate: string | null;
  dateUncertain: boolean;
  datePhrase: string;
};

function normalizePhrase(phrase: string): string {
  return phrase.trim().toLocaleLowerCase("tr-TR");
}

/** Resolve a relative/absolute date phrase against the journal diary date (not "today"). */
export function resolvePlanExtractDate(input: {
  diaryDate: string;
  datePhrase?: string | null;
  aiProposedDate?: string | null;
  aiUncertain?: boolean;
}): DateResolveResult {
  const datePhrase = (input.datePhrase ?? "").trim();
  const uncertainFromPhrase = UNCERTAIN_MARKERS.test(datePhrase) || Boolean(input.aiUncertain);
  const norm = normalizePhrase(datePhrase);

  let proposed: string | null = null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(datePhrase)) {
    try {
      parseCalendarDate(datePhrase);
      proposed = datePhrase;
    } catch {
      proposed = null;
    }
  } else if (norm === "bugün" || norm === "bugun" || norm === "bu akşam" || norm === "bu aksam") {
    proposed = input.diaryDate;
  } else if (norm === "yarın" || norm === "yarin") {
    proposed = addCalendarDays(input.diaryDate, 1);
  } else if (norm === "öbür gün" || norm === "obur gun" || norm === "öbürgün") {
    proposed = addCalendarDays(input.diaryDate, 2);
  } else {
    for (const [name, weekday] of Object.entries(WEEKDAY_TR)) {
      if (norm.includes(name)) {
        proposed = nextWeekdayOnOrAfter(input.diaryDate, weekday);
        break;
      }
    }
  }

  if (!proposed && input.aiProposedDate && /^\d{4}-\d{2}-\d{2}$/.test(input.aiProposedDate)) {
    try {
      parseCalendarDate(input.aiProposedDate);
      // Never silently roll a past date forward — keep AI proposal as-is.
      proposed = input.aiProposedDate;
    } catch {
      /* ignore */
    }
  }

  // Ambiguous / uncertain wording must not assert a confirmed date.
  if (uncertainFromPhrase) {
    return {
      proposedDate: proposed,
      dateUncertain: true,
      datePhrase,
    };
  }

  return {
    proposedDate: proposed,
    dateUncertain: Boolean(datePhrase) && !proposed,
    datePhrase,
  };
}

/** Same calendar week’s weekday on or after diaryDate — do not jump to next week if past. */
function nextWeekdayOnOrAfter(diaryIso: string, targetWeekday: number): string {
  const d = parseCalendarDate(diaryIso);
  const current = d.getUTCDay();
  const delta = (targetWeekday - current + 7) % 7;
  return addCalendarDays(diaryIso, delta);
}

export function excerptOccursInSource(excerpt: string, source: string): boolean {
  const e = excerpt.trim();
  if (!e || e.length < 3) return false;
  const normalize = (s: string) =>
    s
      .toLocaleLowerCase("tr-TR")
      .replace(/\s+/g, " ")
      .trim();
  return normalize(source).includes(normalize(e));
}

/**
 * STUDY_STEP excerpts must show the child's own study/prep intent in the excerpt itself.
 * This rejects invented prep steps that only reuse an exam/homework sentence as excerpt.
 * It does not generate candidates — it only filters ungrounded STUDY_STEP drafts.
 */
export function studyStepExcerptIsGrounded(excerpt: string): boolean {
  const n = excerpt
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return false;

  // Negation / lack of need
  if (
    /\b(gerekmiyor|gerekmez|lazım değil|lazim degil|çalışmayacağım|calismayacagim|çalışmamalıyım|yapmayacağım)\b/u.test(
      n,
    )
  ) {
    return false;
  }

  // Completed past (common diary forms) — not a new pending step
  if (
    /\b(çalıştım|calistim|tekrar ettim|hazırlandım|hazirlandim|bitirdim|yaptım|yaptim|okudum|çözdüm|cozdum)\b/u.test(
      n,
    )
  ) {
    return false;
  }

  // Third person / someone else's task
  if (
    /\b(arkadaşım|arkadasim|kardeşim|kardesim|o çalış|çalışacak|calisacak|onun ödevi|onun odevi)\b/u.test(
      n,
    )
  ) {
    return false;
  }

  // Affirmative study / prep intent cues (child-oriented)
  return /\b(çalış|calis|tekrar|hazırlan|hazirlan|ezber|alıştırma|alistirma|çözmem|cozmem|okumam|çalışmam|calismam|çalışacağım|calisacagim|hazırlanacağım|hazirlanacagim|lazım|lazim|gerek|etmeliyim|yapmalıyım|yapmaliyim)\b/u.test(
    n,
  );
}

/** Commitment types must be grounded in obligation wording in the excerpt (not invented from a study line). */
export function commitmentExcerptIsGrounded(
  type: "HOMEWORK" | "EXAM" | "COURSE",
  excerpt: string,
): boolean {
  const n = excerpt
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return false;
  // Note: JS \\b is ASCII-only; use plain substring / Unicode letters for Turkish stems.
  if (type === "HOMEWORK") {
    return /ödev/u.test(n);
  }
  if (type === "EXAM") {
    return /sınav|sinav|test/u.test(n);
  }
  return /kurs|antrenman|prova|etkinlik|kulüp|kulup|(?<!\p{L})(maç|mac|ders)(?!\p{L})/u.test(n);
}

