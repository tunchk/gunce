import { ProviderError, type TranscriptionInput, type TranscriptionProvider, type TranscriptionResult } from "@/lib/ai/types";

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
/** Current file-transcription model per OpenAI migration guidance (Aug 2026). */
const DEFAULT_MODEL = "gpt-transcribe";
const TIMEOUT_MS = 45_000;

/**
 * OpenAI Audio Transcriptions API (completed short recordings).
 * @see https://platform.openai.com/docs/guides/speech-to-text
 * @see https://developers.openai.com/cookbook/examples/migrating_from_whisper_to_gpt_transcribe
 */
export function createOpenAITranscriptionProvider(): TranscriptionProvider {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  const model = process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || DEFAULT_MODEL;

  return {
    name: "openai-transcription",
    isConfigured() {
      return Boolean(apiKey);
    },
    async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
      if (!apiKey) {
        throw new ProviderError(
          "Ses yazıya çevirme şu an yapılandırılmamış.",
          "NOT_CONFIGURED",
        );
      }

      const form = new FormData();
      const blob = new Blob([new Uint8Array(input.bytes)], {
        type: input.mimeType || "application/octet-stream",
      });
      form.append("file", blob, input.filename || "recording.webm");
      form.append("model", model);
      form.append("response_format", "json");
      form.append(
        "prompt",
        "Türkçe konuşan bir çocuğun kısa günlük anlatımı.",
      );

      // gpt-transcribe uses `languages`; legacy whisper / gpt-4o-* use `language`.
      const legacyLanguage =
        model.startsWith("whisper") || model.includes("4o") || model.includes("gpt-4o");
      if (input.languageHint) {
        if (legacyLanguage) {
          form.append("language", input.languageHint);
        } else {
          form.append("languages", input.languageHint);
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(OPENAI_TRANSCRIBE_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
          signal: controller.signal,
        });

        if (!res.ok) {
          // Do not log response body (may contain snippets of audio-derived text).
          throw new ProviderError(
            "Ses yazıya çevrilemedi. Biraz sonra tekrar dene.",
            "PROVIDER_FAILURE",
          );
        }

        const data = (await res.json()) as { text?: unknown };
        if (typeof data.text !== "string" || !data.text.trim()) {
          throw new ProviderError(
            "Ses anlaşılamadı veya boş bir metin döndü.",
            "INVALID_OUTPUT",
          );
        }

        return { text: data.text.trim(), provider: "openai" };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new ProviderError("Ses yazıya çevirme zaman aşımına uğradı.", "TIMEOUT");
        }
        throw new ProviderError(
          "Ses yazıya çevrilemedi. Biraz sonra tekrar dene.",
          "PROVIDER_FAILURE",
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
