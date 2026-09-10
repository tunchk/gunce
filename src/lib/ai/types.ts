export type TranscriptionInput = {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  languageHint?: string;
};

export type TranscriptionResult = {
  text: string;
  provider: string;
};

export type TranscriptionProvider = {
  readonly name: string;
  isConfigured(): boolean;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
};

export type SummarizationInput = {
  sourceText: string;
  promptLabel?: string | null;
};

export type SummarizationResult = {
  summary: string;
  provider: string;
};

export type SummarizationProvider = {
  readonly name: string;
  isConfigured(): boolean;
  summarize(input: SummarizationInput): Promise<SummarizationResult>;
};

export type ParentGuidanceInput = {
  parentMessage: string;
  supportRequest: string;
};

export type ParentGuidanceResult = {
  conversationOpener: string;
  supportAction: string;
  provider: string;
};

export type ParentGuidanceProvider = {
  readonly name: string;
  isConfigured(): boolean;
  generate(input: ParentGuidanceInput): Promise<ParentGuidanceResult>;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    public code:
      | "NOT_CONFIGURED"
      | "TIMEOUT"
      | "INVALID_OUTPUT"
      | "PROVIDER_FAILURE"
      | "UNSUPPORTED",
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
