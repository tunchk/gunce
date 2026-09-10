import {
  ProviderError,
  type ParentGuidanceProvider,
  type SummarizationProvider,
  type TranscriptionProvider,
} from "@/lib/ai/types";

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
