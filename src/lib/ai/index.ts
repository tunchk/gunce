import { createOpenAIParentGuidanceProvider } from "@/lib/ai/openai-parent-guidance";
import { createOpenAIPlanExtractProvider } from "@/lib/ai/openai-plan-extract";
import { createOpenAISummarizationProvider } from "@/lib/ai/openai-summarization";
import { createOpenAITranscriptionProvider } from "@/lib/ai/openai-transcription";
import {
  createTestParentGuidanceProvider,
  createTestPlanExtractProvider,
  createTestSummarizationProvider,
  createTestTranscriptionProvider,
} from "@/lib/ai/test-providers";
import type {
  ParentGuidanceProvider,
  PlanExtractProvider,
  SummarizationProvider,
  TranscriptionProvider,
} from "@/lib/ai/types";

let transcriptionOverride: TranscriptionProvider | null = null;
let summarizationOverride: SummarizationProvider | null = null;
let parentGuidanceOverride: ParentGuidanceProvider | null = null;
let planExtractOverride: PlanExtractProvider | null = null;

function isAiTestModeEnabled() {
  if (process.env.GUNCE_AI_TEST_MODE !== "1") return false;
  // `next start` sets NODE_ENV=production. Real production hosts must not set
  // GUNCE_ALLOW_AI_TEST_STUBS. Playwright sets both flags for its local server only.
  if (process.env.NODE_ENV === "production") {
    return process.env.GUNCE_ALLOW_AI_TEST_STUBS === "1";
  }
  return true;
}

export function setTranscriptionProviderForTests(provider: TranscriptionProvider | null) {
  transcriptionOverride = provider;
}

export function setSummarizationProviderForTests(provider: SummarizationProvider | null) {
  summarizationOverride = provider;
}

export function setParentGuidanceProviderForTests(provider: ParentGuidanceProvider | null) {
  parentGuidanceOverride = provider;
}

export function setPlanExtractProviderForTests(provider: PlanExtractProvider | null) {
  planExtractOverride = provider;
}

export function getTranscriptionProvider(): TranscriptionProvider {
  if (transcriptionOverride) return transcriptionOverride;
  if (isAiTestModeEnabled()) return createTestTranscriptionProvider();
  return createOpenAITranscriptionProvider();
}

export function getSummarizationProvider(): SummarizationProvider {
  if (summarizationOverride) return summarizationOverride;
  if (isAiTestModeEnabled()) return createTestSummarizationProvider();
  return createOpenAISummarizationProvider();
}

export function getParentGuidanceProvider(): ParentGuidanceProvider {
  if (parentGuidanceOverride) return parentGuidanceOverride;
  if (isAiTestModeEnabled()) return createTestParentGuidanceProvider();
  return createOpenAIParentGuidanceProvider();
}

export function getPlanExtractProvider(): PlanExtractProvider {
  if (planExtractOverride) return planExtractOverride;
  if (isAiTestModeEnabled()) return createTestPlanExtractProvider();
  return createOpenAIPlanExtractProvider();
}

export function getAiFeatureStatus() {
  const transcription = getTranscriptionProvider();
  const summarization = getSummarizationProvider();
  const parentGuidance = getParentGuidanceProvider();
  const planExtract = getPlanExtractProvider();
  return {
    transcriptionAvailable: transcription.isConfigured(),
    summarizationAvailable: summarization.isConfigured(),
    parentGuidanceAvailable: parentGuidance.isConfigured(),
    planExtractAvailable: planExtract.isConfigured(),
    transcriptionProvider: transcription.name,
    summarizationProvider: summarization.name,
    parentGuidanceProvider: parentGuidance.name,
    planExtractProvider: planExtract.name,
  };
}
