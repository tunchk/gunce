import { describe, expect, it } from "vitest";
import {
  applyTranscriptResult,
  assembleTranscript,
  cancelCurrentRecordingSegment,
  discardSegment,
  discardedGapNotice,
  hasUnresolvedSegments,
  markSegmentFailed,
  nextSequence,
  progressLabel,
  type VoiceSegment,
} from "@/lib/voice-segments";

function seg(
  partial: Partial<VoiceSegment> & Pick<VoiceSegment, "id" | "sequence" | "status">,
): VoiceSegment {
  return { transcript: "", ...partial };
}

describe("voice segments helpers", () => {
  it("assigns increasing sequence numbers", () => {
    expect(nextSequence([])).toBe(1);
    expect(nextSequence([{ sequence: 1 }, { sequence: 3 }])).toBe(4);
  });

  it("assembles transcripts in sequence order even if array is shuffled", () => {
    const segments = [
      seg({ id: "b", sequence: 2, status: "completed", transcript: "ikinci" }),
      seg({ id: "a", sequence: 1, status: "completed", transcript: "birinci" }),
      seg({ id: "c", sequence: 3, status: "failed", transcript: "yok" }),
    ];
    expect(assembleTranscript(segments)).toBe("birinci\n\nikinci");
  });

  it("retry apply does not duplicate completed transcript", () => {
    let segments = [
      seg({ id: "a", sequence: 1, status: "transcribing", transcript: "" }),
    ];
    segments = applyTranscriptResult(segments, "a", "merhaba");
    segments = applyTranscriptResult(segments, "a", "TEKRAR");
    expect(assembleTranscript(segments)).toBe("merhaba");
  });

  it("failed segment leaves others intact", () => {
    let segments = [
      seg({ id: "a", sequence: 1, status: "completed", transcript: "ok" }),
      seg({ id: "b", sequence: 2, status: "transcribing", transcript: "" }),
    ];
    segments = markSegmentFailed(segments, "b", "hata");
    expect(segments.find((s) => s.id === "a")?.status).toBe("completed");
    expect(segments.find((s) => s.id === "b")?.status).toBe("failed");
    expect(assembleTranscript(segments)).toBe("ok");
  });

  it("discarding a failed segment marks a clear gap", () => {
    let segments = [
      seg({ id: "a", sequence: 1, status: "completed", transcript: "a" }),
      seg({ id: "b", sequence: 2, status: "failed", transcript: "" }),
    ];
    segments = discardSegment(segments, "b");
    expect(hasUnresolvedSegments(segments)).toBe(false);
    expect(discardedGapNotice(segments)).toMatch(/2\. bölüm atlandı/);
    expect(assembleTranscript(segments)).toBe("a");
  });

  it("cancelling current recording preserves completed segments", () => {
    let segments = [
      seg({ id: "a", sequence: 1, status: "completed", transcript: "önceki" }),
      seg({ id: "b", sequence: 2, status: "recording", transcript: "" }),
    ];
    segments = cancelCurrentRecordingSegment(segments, "b");
    expect(segments.find((s) => s.id === "a")?.transcript).toBe("önceki");
    expect(segments.find((s) => s.id === "b")?.status).toBe("cancelled");
  });

  it("late result cannot restore cancelled or discarded content", () => {
    let segments = [
      seg({ id: "a", sequence: 1, status: "cancelled", transcript: "" }),
    ];
    segments = applyTranscriptResult(segments, "a", "geç kaldı");
    expect(segments[0]?.status).toBe("cancelled");
    expect(assembleTranscript(segments)).toBe("");

    segments = [seg({ id: "b", sequence: 1, status: "discarded", transcript: "" })];
    segments = applyTranscriptResult(segments, "b", "geç kaldı");
    expect(segments[0]?.status).toBe("discarded");
  });

  it("progress label stays child-friendly", () => {
    const label = progressLabel([
      seg({ id: "a", sequence: 1, status: "completed", transcript: "x" }),
      seg({ id: "b", sequence: 2, status: "transcribing", transcript: "" }),
      seg({ id: "c", sequence: 3, status: "failed", transcript: "" }),
    ]);
    expect(label).toContain("1 bölüm hazır");
    expect(label).toContain("yazıya çevriliyor");
    expect(label).not.toMatch(/chunk|buffer|queue/i);
  });
});
