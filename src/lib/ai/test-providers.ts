import {
  ProviderError,
  type ParentGuidanceProvider,
  type PlanExtractProvider,
  type SummarizationProvider,
  type TranscriptionProvider,
} from "@/lib/ai/types";
import { resolvePlanExtractDate } from "@/lib/plan-extract-dates";

/**
 * Deterministic stubs for automated tests only.
 * Enabled when GUNCE_AI_TEST_MODE=1 (never fabricate AI in normal app mode).
 */
export function createTestTranscriptionProvider(): TranscriptionProvider {
  return {
    name: "test-transcription",
    isConfigured: () => true,
    async transcribe(input) {
      if (input.bytes.length === 0) {
        throw new ProviderError("Boş ses.", "INVALID_OUTPUT");
      }
      if (input.bytes.toString("utf8").includes("FAIL_TRANSCRIBE")) {
        throw new ProviderError("test failure", "PROVIDER_FAILURE");
      }
      return {
        text: "Test çözümlemesi: bugün okuldaydım.",
        provider: "test",
      };
    },
  };
}

export function createTestSummarizationProvider(): SummarizationProvider {
  return {
    name: "test-summarization",
    isConfigured: () => true,
    async summarize(input) {
      const source = input.sourceText.trim();
      if (!source) {
        throw new ProviderError("Boş metin.", "INVALID_OUTPUT");
      }
      if (source.includes("__FAIL_SUMMARY__")) {
        throw new ProviderError(
          "Özet önerisi alınamadı. Yazın duruyor.",
          "PROVIDER_FAILURE",
        );
      }
      if (source.includes("__INVALID_SUMMARY__")) {
        throw new ProviderError("Özet önerisi geçersiz döndü.", "INVALID_OUTPUT");
      }
      if (source.includes("__TIMEOUT_SUMMARY__")) {
        throw new ProviderError("Özet önerisi zaman aşımına uğradı.", "TIMEOUT");
      }
      const clipped = source.length > 180 ? `${source.slice(0, 177)}…` : source;
      return {
        summary: `Özet: ${clipped}`,
        provider: "test",
      };
    },
  };
}

export function createTestParentGuidanceProvider(): ParentGuidanceProvider {
  return {
    name: "test-parent-guidance",
    isConfigured: () => true,
    async generate(input) {
      const message = input.parentMessage.trim();
      const support = input.supportRequest.trim();
      if (!message && !support) {
        throw new ProviderError("Paylaşılan içerik yok.", "INVALID_OUTPUT");
      }
      if (`${message}\n${support}`.includes("__FAIL_GUIDANCE__")) {
        throw new ProviderError("Yaklaşım önerisi alınamadı.", "PROVIDER_FAILURE");
      }
      const limited =
        message.length < 40 || /zorlandığım bir durum/i.test(message);
      return {
        conversationOpener: limited
          ? "İstersen seni dinleyebilirim. Anlatmak ister misin?"
          : `Hangi adımda takıldığını bana göstermek ister misin? (${message.slice(0, 48)})`,
        supportAction: limited
          ? "Birlikte sakin bir anda konuşmak için kısa bir zaman ayırabilirsiniz."
          : "İsterse birlikte tek bir örnek çözmek için kısa bir zaman ayırabilirsiniz.",
        provider: "test",
      };
    },
  };
}

/** Deterministic plan-extract stub for automated tests (acceptance-shaped). */
export function createTestPlanExtractProvider(): PlanExtractProvider {
  return {
    name: "test-plan-extract",
    isConfigured: () => true,
    async extract(input) {
      const source = input.sourceText.trim();
      if (!source) {
        throw new ProviderError("Öneri için metin boş.", "INVALID_OUTPUT");
      }
      if (source.includes("__FAIL_EXTRACT__")) {
        throw new ProviderError(
          "Plan önerisi alınamadı. Yazın ve planın duruyor.",
          "PROVIDER_FAILURE",
        );
      }
      if (source.includes("__INVALID_EXTRACT__")) {
        throw new ProviderError("Plan önerisi geçersiz döndü.", "INVALID_OUTPUT");
      }
      if (source.includes("__TIMEOUT_EXTRACT__")) {
        throw new ProviderError("Plan önerisi zaman aşımına uğradı.", "TIMEOUT");
      }
      if (source.includes("__EMPTY_EXTRACT__")) {
        return { candidates: [], provider: "test" };
      }

      const candidates = [];

      const examMatch = source.match(/Almanca kelime sınavım var/i);
      if (examMatch) {
        const yarin = resolvePlanExtractDate({
          diaryDate: input.diaryDate,
          datePhrase: "yarın",
        });
        candidates.push({
          type: "EXAM" as const,
          mentionKind: "EXPLICIT" as const,
          title: "Almanca kelime sınavı",
          subject: "Almanca",
          sourceExcerpt: "Yarın Almanca kelime sınavım var",
          datePhrase: "yarın",
          proposedDate: yarin.proposedDate,
          dateUncertain: false,
          estimatedMinutes: null,
          relatedCandidateIndex: null,
        });
      }

      const prepMatch = source.match(/kelimelere çalışmam lazım/i);
      if (prepMatch) {
        const aksam = resolvePlanExtractDate({
          diaryDate: input.diaryDate,
          datePhrase: "bu akşam",
        });
        candidates.push({
          type: "STUDY_STEP" as const,
          mentionKind: "PREPARATION" as const,
          title: "Almanca kelimelerine çalış",
          subject: "Almanca",
          sourceExcerpt: "Bu akşam kelimelere çalışmam lazım",
          datePhrase: "bu akşam",
          proposedDate: aksam.proposedDate ?? input.diaryDate,
          dateUncertain: false,
          estimatedMinutes: null,
          relatedCandidateIndex: examMatch ? 0 : null,
        });
      }

      const hwMatch = source.match(/Matematik ödevinin teslim tarihini bilmiyorum/i);
      if (hwMatch) {
        candidates.push({
          type: "HOMEWORK" as const,
          mentionKind: "EXPLICIT" as const,
          title: "Matematik ödevi",
          subject: "Matematik",
          sourceExcerpt: "Matematik ödevinin teslim tarihini bilmiyorum",
          datePhrase: "teslim tarihini bilmiyorum",
          proposedDate: null,
          dateUncertain: true,
          estimatedMinutes: null,
          relatedCandidateIndex: null,
        });
      }

      const uncertainExam = source.match(/Galiba cuma sınav/i);
      if (uncertainExam) {
        const cuma = resolvePlanExtractDate({
          diaryDate: input.diaryDate,
          datePhrase: "Galiba cuma",
          aiUncertain: true,
        });
        candidates.push({
          type: "EXAM" as const,
          mentionKind: "EXPLICIT" as const,
          title: "Sınav",
          sourceExcerpt: "Galiba cuma sınav var",
          datePhrase: "Galiba cuma",
          proposedDate: cuma.proposedDate,
          dateUncertain: true,
          estimatedMinutes: null,
          relatedCandidateIndex: null,
        });
      }

      // Happy memories must not become tasks — deliberately ignore basketbol pas etc.
      return { candidates, provider: "test" };
    },
  };
}
