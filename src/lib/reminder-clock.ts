/**
 * Injectable clock for reminder scheduling tests.
 */
let nowOverride: (() => Date) | null = null;

export function setReminderNowForTests(fn: (() => Date) | null) {
  nowOverride = fn;
}

export function reminderNow(): Date {
  return nowOverride ? nowOverride() : new Date();
}

export const REMINDER_GRACE_MS = 30 * 60 * 1000;
export const REMINDER_DAILY_CAP = 3;
export const REMINDER_CLAIM_LEASE_MS = 60_000;
export const REMINDER_MAX_ATTEMPTS = 5;
export const REMINDER_BATCH_SIZE = 25;
