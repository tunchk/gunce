import { describe, expect, it, afterEach } from "vitest";
import {
  getAiFeatureStatus,
  getSummarizationProvider,
  getTranscriptionProvider,
  setSummarizationProviderForTests,
  setTranscriptionProviderForTests,
} from "@/lib/ai";

const env = process.env as Record<string, string | undefined>;

describe("AI test-mode production guard", () => {
  const prev = {
    NODE_ENV: env.NODE_ENV,
    GUNCE_AI_TEST_MODE: env.GUNCE_AI_TEST_MODE,
    GUNCE_ALLOW_AI_TEST_STUBS: env.GUNCE_ALLOW_AI_TEST_STUBS,
  };

  afterEach(() => {
    setTranscriptionProviderForTests(null);
    setSummarizationProviderForTests(null);
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  });

  it("ignores GUNCE_AI_TEST_MODE alone when NODE_ENV=production", () => {
    env.NODE_ENV = "production";
    env.GUNCE_AI_TEST_MODE = "1";
    delete env.GUNCE_ALLOW_AI_TEST_STUBS;

    expect(getTranscriptionProvider().name).toBe("openai-transcription");
    expect(getSummarizationProvider().name).toBe("openai-summarization");
  });

  it("allows stubs in production only with explicit allow flag (Playwright)", () => {
    env.NODE_ENV = "production";
    env.GUNCE_AI_TEST_MODE = "1";
    env.GUNCE_ALLOW_AI_TEST_STUBS = "1";

    expect(getTranscriptionProvider().name).toBe("test-transcription");
    expect(getSummarizationProvider().name).toBe("test-summarization");
    expect(getAiFeatureStatus().transcriptionAvailable).toBe(true);
    expect(getAiFeatureStatus().parentGuidanceAvailable).toBe(true);
  });
});
