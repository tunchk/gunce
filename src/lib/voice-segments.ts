/**
 * Pure helpers for multi-part voice recording sessions.
 * Audio never lives here — only segment metadata and transcript text.
 */

export const SEGMENT_MAX_MS = 120_000;
export const SEGMENT_SOFT_WARN_MS = 100_000;
/** Soft cap so children get a clear limit without recreating a single 120s wall. */
export const MAX_SEGMENTS_PER_SESSION = 12;
export const TRANSCRIBE_CONCURRENCY = 2;

export type SegmentStatus =
  | "recording"
  | "pending"
  | "transcribing"
  | "completed"
  | "failed"
  | "cancelled"
  | "discarded";

export type VoiceSegment = {
  id: string;
  sequence: number;
  status: SegmentStatus;
  transcript: string;
  /** True when this segment left a hole after explicit discard. */
  discardedGap?: boolean;
  error?: string;
};

export function createSegmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `seg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `vs_${crypto.randomUUID()}`;
  }
  return `vs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function nextSequence(segments: Array<{ sequence: number }>): number {
  if (segments.length === 0) return 1;
  return Math.max(...segments.map((s) => s.sequence)) + 1;
}

/** Completed transcripts in recording order (sequence ascending). */
export function assembleTranscript(segments: VoiceSegment[]): string {
  return segments
    .filter((s) => s.status === "completed" && s.transcript.trim())
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => s.transcript.trim())
    .join("\n\n");
}

export function countByStatus(segments: VoiceSegment[]) {
  const counts = {
    completed: 0,
    pending: 0,
    transcribing: 0,
    failed: 0,
    discarded: 0,
    recording: 0,
    cancelled: 0,
  };
  for (const s of segments) {
    counts[s.status] += 1;
  }
  return counts;
}

export function progressLabel(segments: VoiceSegment[]): string {
  const c = countByStatus(segments);
  const parts: string[] = [];
  if (c.completed > 0) {
    parts.push(
      `${c.completed} bölüm hazır`,
    );
  }
  const converting = c.pending + c.transcribing;
  if (converting > 0) {
    parts.push(
      `${converting} bölüm yazıya çevriliyor`,
    );
  }
  if (c.failed > 0) {
    parts.push(`${c.failed} bölüm çevrilemedi`);
  }
  if (c.discarded > 0) {
    parts.push(`${c.discarded} bölüm atlandı`);
  }
  return parts.join(", ") || "Henüz bölüm yok";
}

export function hasUnresolvedSegments(segments: VoiceSegment[]): boolean {
  return segments.some((s) =>
    s.status === "pending" ||
    s.status === "transcribing" ||
    s.status === "failed" ||
    s.status === "recording",
  );
}

export function hasRecoverableAudioRisk(segments: VoiceSegment[]): boolean {
  return segments.some((s) =>
    s.status === "failed" ||
    s.status === "pending" ||
    s.status === "transcribing" ||
    s.status === "recording",
  );
}

export function discardedGapNotice(segments: VoiceSegment[]): string | null {
  const gaps = segments
    .filter((s) => s.status === "discarded")
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => s.sequence);
  if (gaps.length === 0) return null;
  if (gaps.length === 1) {
    return `${gaps[0]}. bölüm atlandı; anlatımda bir boşluk olabilir.`;
  }
  return `Atlanan bölümler: ${gaps.join(", ")}. Anlatımda boşluklar olabilir.`;
}

/**
 * Apply an out-of-order transcription result without duplicating text on retry.
 * If the segment already has completed text for the same id, keep the first success.
 */
export function applyTranscriptResult(
  segments: VoiceSegment[],
  segmentId: string,
  text: string,
): VoiceSegment[] {
  return segments.map((s) => {
    if (s.id !== segmentId) return s;
    if (s.status === "cancelled" || s.status === "discarded") return s;
    if (s.status === "completed" && s.transcript.trim()) return s;
    return {
      ...s,
      status: "completed",
      transcript: text.trim(),
      error: undefined,
    };
  });
}

export function markSegmentFailed(
  segments: VoiceSegment[],
  segmentId: string,
  error: string,
): VoiceSegment[] {
  return segments.map((s) => {
    if (s.id !== segmentId) return s;
    if (s.status === "cancelled" || s.status === "discarded" || s.status === "completed") {
      return s;
    }
    return { ...s, status: "failed", error };
  });
}

export function discardSegment(
  segments: VoiceSegment[],
  segmentId: string,
): VoiceSegment[] {
  return segments.map((s) =>
    s.id === segmentId
      ? {
          ...s,
          status: "discarded" as const,
          discardedGap: true,
          error: undefined,
        }
      : s,
  );
}

export function cancelCurrentRecordingSegment(
  segments: VoiceSegment[],
  segmentId: string,
): VoiceSegment[] {
  return segments.map((s) =>
    s.id === segmentId && (s.status === "recording" || s.status === "pending")
      ? { ...s, status: "cancelled" as const }
      : s,
  );
}
