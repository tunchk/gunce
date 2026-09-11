import { describe, expect, it } from "vitest";
import {
  applyQuietHoursPolicy,
  isInQuietHours,
  localTimeToMinutes,
  resolveDeliveryInstant,
  zonedLocalDateTimeToUtc,
  getZonedParts,
} from "@/lib/reminder-time";

describe("reminder time helpers", () => {
  it("detects quiet hours spanning midnight", () => {
    expect(isInQuietHours(localTimeToMinutes("22:00"), "21:00", "08:00")).toBe(true);
    expect(isInQuietHours(localTimeToMinutes("07:00"), "21:00", "08:00")).toBe(true);
    expect(isInQuietHours(localTimeToMinutes("12:00"), "21:00", "08:00")).toBe(false);
  });

  it("defers same-day quiet or skips when next permitted is next day", () => {
    expect(
      applyQuietHoursPolicy({
        localTime: "22:00",
        quietStart: "21:00",
        quietEnd: "08:00",
      }),
    ).toEqual({ action: "skip" });
    expect(
      applyQuietHoursPolicy({
        localTime: "07:00",
        quietStart: "21:00",
        quietEnd: "08:00",
      }),
    ).toEqual({ action: "defer", localTime: "08:00" });
    expect(
      applyQuietHoursPolicy({
        localTime: "14:00",
        quietStart: "13:00",
        quietEnd: "15:00",
      }),
    ).toEqual({ action: "defer", localTime: "15:00" });
  });

  it("converts Europe/Berlin local wall time to a consistent UTC instant", () => {
    const utc = zonedLocalDateTimeToUtc({
      timeZone: "Europe/Berlin",
      localDate: "2026-09-10",
      localTime: "19:00",
    });
    const parts = getZonedParts(utc, "Europe/Berlin");
    expect(parts.date).toBe("2026-09-10");
    expect(parts.hour).toBe(19);
    expect(parts.minute).toBe(0);
  });

  it("handles Europe/Berlin spring-forward gap (nonexistent 02:30 → later valid)", () => {
    // 2026-03-29 02:00–03:00 does not exist in Europe/Berlin
    const utc = zonedLocalDateTimeToUtc({
      timeZone: "Europe/Berlin",
      localDate: "2026-03-29",
      localTime: "02:30",
    });
    const parts = getZonedParts(utc, "Europe/Berlin");
    expect(parts.date).toBe("2026-03-29");
    expect(parts.minutes).toBeGreaterThanOrEqual(3 * 60);
  });

  it("creates a single occurrence for fall-back overlap (repeated local time)", () => {
    // 2026-10-25 02:30 occurs twice in Europe/Berlin; pick earliest UTC
    const a = zonedLocalDateTimeToUtc({
      timeZone: "Europe/Berlin",
      localDate: "2026-10-25",
      localTime: "02:30",
    });
    const b = zonedLocalDateTimeToUtc({
      timeZone: "Europe/Berlin",
      localDate: "2026-10-25",
      localTime: "02:30",
    });
    expect(a.getTime()).toBe(b.getTime());
    const parts = getZonedParts(a, "Europe/Berlin");
    expect(parts.date).toBe("2026-10-25");
    expect(parts.hour).toBe(2);
    expect(parts.minute).toBe(30);
  });

  it("resolveDeliveryInstant skips evening quiet journal slot", () => {
    const result = resolveDeliveryInstant({
      timeZone: "Europe/Berlin",
      localDate: "2026-09-10",
      localTime: "22:30",
      quietStart: "21:00",
      quietEnd: "08:00",
    });
    expect(result).toEqual({ skip: true });
  });
});
