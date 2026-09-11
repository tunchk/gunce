# Günce — Architecture

## Stack

- **Next.js 15** (App Router) + **TypeScript** + **React 19**
- **PostgreSQL** via **Prisma ORM** (Homebrew `postgresql@15` recommended locally; Docker optional)
- **Better Auth** for email/password parent authentication and database-backed sessions
- **Vitest** integration tests on `gunce_test` only
- **Playwright** browser E2E on `gunce_test` (optional; requires Chromium install)
- **OpenAI** (optional) for speech-to-text and structured summarization — credentials server-side only

## Identity model (Milestone 1)

| Actor  | Auth user                         | App records                                      |
|--------|-----------------------------------|--------------------------------------------------|
| Parent | Better Auth `User` (`role=PARENT`)| `FamilyMembership` → `Family` → `ChildProfile`s |
| Child  | Better Auth `User` (`role=CHILD`) | `ChildProfile.userId` (synthetic email, never shown) |

### Email verification & password recovery (Milestone 9)

`User.emailVerified` defaults to `false`. Registration sends a verification email via Better Auth `emailVerification` hooks but **does not** require verification for sign-in (`requireEmailVerification` remains unset/false). Existing unverified accounts stay unverified until they confirm.

Links use the configured app origin (`BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` via `getAppOrigin()`), not request Host headers. Verification emails point to `/veli/eposta-dogrula?token=…`; the token is consumed only when the parent submits **E-postamı doğrula** (Better Auth `verifyEmail`). Password-reset emails point to `/veli/sifre-yenile?token=…`; GET does not consume the token — only successful `resetPassword` does (`consumeVerificationValue`). `revokeSessionsOnPasswordReset` deletes that parent’s sessions; `onPasswordReset` also deletes remaining `reset-password:*` verification rows for the user. Reset does **not** set `emailVerified`.

Mail delivery is abstracted in `src/lib/mail.ts` (`sendMail`). Local transports only: file preview (`GUNCE_MAIL_PREVIEW=1` → `.mail-preview/`, never production) and test capture (`GUNCE_MAIL_TEST_CAPTURE`). In `NODE_ENV=production`, capture requires loopback app origin **and** `GUNCE_ALLOW_MAIL_TEST_CAPTURE=1`. HTTP `GET /api/auth/verify-email` is blocked in middleware; confirm uses single-use redemption hashes plus Better Auth JWT verify. No production email provider in this milestone.

## Multi-guardian & share audiences (Milestone 10)

| Concept | Model | Notes |
|---------|-------|-------|
| Child access | `ChildGuardianAccess` | `MANAGER` / `INVITED`, `generation`, soft `revokedAt` |
| Guardian invite | `GuardianInvitation` | hashed token, email-bound, single-use |
| Share audience | `PublishedShareRecipient` | `accessGeneration` must match active access |

Pre-migration authorization was “any `FamilyMembership` of `PublishedShare.familyId`”. Migration backfills MANAGER access for each membership×child and recipients for each share×membership (generation 1). Parent list/detail/guidance now require active access **and** matching recipient generation.

## Journal & sharing model (Milestone 2)

Private writing and parent-visible content are separate records:

| Concept | Model | Notes |
|---------|-------|-------|
| Private journal | `JournalEntry` | `body` is child-only; never returned by parent APIs |
| Parent-facing draft | `SharingDraft` | Independent `parentMessage` + `supportRequest`; editable without publishing |
| Published snapshot | `PublishedShare` | Approved copy parents can read; soft-withdrawn via `withdrawnAt` |
| Parent approach tips | `ParentGuidance` | Cached AI tips tied to `sourceDraftRevision`; built only from published fields |

Parent home shows excerpts of approved `parentMessage` with **Detayı gör**. Detail at `/veli/paylasim/[shareId]` shows the full published message, the child’s support request (if any), and labeled AI approach tips. Pairing/session controls live under `/veli/ayarlar`.

Semantics:

- New entries are private by default.
- Editing `JournalEntry.body` does not change `PublishedShare`.
- Editing `SharingDraft` does not change an existing published snapshot until the child publishes again (“Paylaşımı güncelle”).
- Withdrawal sets `withdrawnAt`; subsequent parent queries exclude the row. Withdrawal does not erase what a parent already read; republishing is allowed.
- Deleting a `JournalEntry` cascades drafts, published shares, transcripts, and suggestions.
- Optimistic concurrency via `revision` / `expectedRevision` on body and draft updates.
- Retry-safe create via optional unique `clientRequestId`.
- Parent list/detail APIs send `Cache-Control: private, no-store`.

## Voice & AI summary model (Milestone 3)

| Concept | Model / API | Notes |
|---------|-------------|-------|
| Working text | `JournalEntry.body` | Typed text, reviewed transcript, or accepted summary |
| Preserved original | `JournalEntry.originalBody` | Child-authored / reviewed text kept when accepting a summary |
| Accepted summary | `JournalEntry.acceptedSummary` | Private; copy into sharing draft is explicit |
| Transcript text | `JournalTranscript` | Text only; audio never persisted by the app. Multi-part sessions use `segmentId` / `sequence` / `sessionId` |
| AI suggestion | `JournalSuggestion` | Tied to `sourceRevision` + unique `requestId`; statuses PENDING / ACCEPTED / DISCARDED / STALE |

### Multi-part voice segments

- Each take is bounded (~120s) with a soft warning before the limit; **Devam et** / **Bitirdim** are explicit (no auto-restart, no invisible background slicing).
- Soft session cap: **12 segments** per recording session (communicated in the UI); completed transcripts are preserved.
- Client keeps failed audio **in memory only** for retry; unfinished audio does **not** survive refresh, tab close, crash, or navigation away.
- Transcription concurrency is bounded (2); results are ordered by `sequence` even if responses arrive out of order.
- Retries use stable `segmentId` so the server does not duplicate transcript rows.
- Summarization still uses one child-reviewed assembled narrative via **Yazımı toparla** — never per-segment summaries concatenated.

Providers (small interfaces, not a multi-provider framework):

- `TranscriptionProvider` → OpenAI `POST /v1/audio/transcriptions` (default model `gpt-transcribe`)
- `SummarizationProvider` → OpenAI Chat Completions with strict JSON schema (`summary` field)

Routes:

- `POST /api/child/journal/[id]/transcribe` — multipart audio; auth, size/MIME, rate limits; optional apply
- `POST /api/child/journal/[id]/summarize` — rate limits; revision checks before/after provider; mid-flight delete → no recreate
- `PATCH` ops: `apply_transcript`, `accept_suggestion`, `discard_suggestion`

Guards:

- Missing `OPENAI_API_KEY` → journaling works; UI marks voice/summary unavailable (no fabricated AI in normal mode)
- `GUNCE_AI_TEST_MODE=1` → deterministic stubs for automated tests only. When `NODE_ENV=production`, stubs also require `GUNCE_ALLOW_AI_TEST_STUBS=1` (Playwright sets both on its local server). Do not set these on a real production host.
- Parent APIs never receive transcripts, suggestions, `originalBody`, or private `body`
- Do not log journal content, audio, provider request bodies, or sensitive provider responses

## Weekly planning model (Milestone 4)

| Concept | Model | Notes |
|---------|-------|-------|
| Commitment | `PlanCommitment` | `HOMEWORK` / `EXAM` / `COURSE`; homework `dueDate` (nullable = tarih belli değil); exam/course `eventDate` (+ optional `eventTimeLocal` as child-local `HH:mm`) |
| Study step | `PlanStudyStep` | Optional `plannedDate`, optional `estimatedMinutes` (planned effort only), optional `relatedCommitmentId`; workflow `status`: `TODO` / `IN_PROGRESS` / `DONE` (authoritative); optional `completedAt` metadata when entering DONE |
| Concurrency | `revision` / `expectedRevision` | Same conflict pattern as journal |
| Idempotent create | `clientRequestId` | Unique; duplicate POSTs return the existing row |

Date and workflow:

- Calendar dates stored as PostgreSQL `DATE` / Prisma `@db.Date` (UTC midnight of `YYYY-MM-DD`).
- “Today” and week boundaries use the child’s `ChildProfile.timeZone`.
- Weeks are Monday–Sunday. Rescheduling a study step updates only `plannedDate` (status and `completedAt` unchanged).
- Status mutations use explicit desired state (`set_status`); retry-safe; never flip on repeat.
- Entering `DONE` sets `completedAt` to server time; repeating `DONE` keeps the existing timestamp; leaving `DONE` clears it.
- Completing a step does not complete linked commitments. Commitment `completedAt` is unchanged.
- Migration `20260910190000_study_step_status`: former boolean completion → `status`, then dropped study-step `completedAt`.
- Migration `20260910200000_study_step_completed_at_metadata`: restores optional `completedAt` as metadata only. Rows already `DONE` before this migration keep `completedAt` null (historical timestamps were not recoverable; do not invent migration-time dates).

Board (Milestone 4.1):

- Child UI: `/cocuk/haftam?view=hafta|pano` — same week payload; board columns filter by `status`.
- Unscheduled open steps and missed (prior days, not DONE) stay in compact sections.
- Parent week view shows Turkish status labels; write APIs remain 403.

Routes:

- Child: `GET/POST /api/child/plan`, `GET/PATCH/DELETE /api/child/plan/commitment/[id]`, `GET/PATCH/DELETE /api/child/plan/step/[id]` (`op: set_status`)
- Parent: `GET /api/parent/plan` (read-only); `POST/PATCH/PUT/DELETE` → 403
- UI: `/cocuk/haftam`, `/cocuk/plan/yeni`, `/cocuk/plan/is/[id]`, `/cocuk/plan/adim/[id]`, `/veli/plan`

Parent plan payloads contain only plan fields for family children — never journal bodies, transcripts, suggestions, or share drafts.

## Long-term goals (Milestone 5)

| Concept | Model | Notes |
|---------|-------|-------|
| Goal | `PlanGoal` | Title, optional `description`, optional `targetDate` (`@db.Date`), `status` ACTIVE/ACHIEVED/ARCHIVED, `revision`, optional `clientRequestId` |
| Link | `PlanStudyStep.relatedGoalId` | At most one goal per step; may also link to a homework/exam commitment; same child only |
| Progress | Derived | `DONE` count / linked step count; label like `1 / 2 adım tamamlandı`; null ratio when zero steps |

Behavior:

- Creating/attaching steps does not copy rows; week and board show the same `PlanStudyStep` ids.
- Goal lifecycle does not auto-change when steps complete or reopen; achieving is explicit.
- Archiving does not unschedule or complete steps. Deleting a goal sets `relatedGoalId` to null (steps kept).
- Attaching a step already linked to another goal requires `allowMove: true` (no silent reassignment).

Routes:

- Child: `GET/POST /api/child/goals`, `GET/PATCH/DELETE /api/child/goals/[id]`
- Parent: `GET /api/parent/goals` (read-only); writes → 403
- UI: `/cocuk/hedefler`, `/cocuk/hedefler/yeni`, `/cocuk/hedefler/[id]`, `/veli/hedefler`

Migration: `20260910210000_plan_goals`.

## Journal → plan extraction (Milestone 6)

| Concept | Model | Notes |
|---------|-------|-------|
| Suggestion batch | `PlanExtractBatch` | Tied to `entryId` + `sourceRevision`; `requestId` idempotent; status READY / STALE / APPLIED; optional `applyRequestId` |
| Candidate | `PlanExtractCandidate` | HOMEWORK / EXAM / COURSE / STUDY_STEP; `mentionKind` EXPLICIT / PREPARATION; `sourceExcerpt` (private); date phrase + proposed date + uncertainty; optional link ordinal; apply status PENDING / APPLIED / SKIPPED |
| Plan writes | Existing | Apply uses `createCommitment` / `createStudyStep` with per-candidate `clientRequestId` |

Behavior:

- Source text prefers `originalBody` when an accepted AI summary replaced `body`.
- Relative dates resolve against the journal `diaryDate` and child time zone; uncertain phrases stay uncertain; past dates are not rolled forward.
- Excerpt must occur in the source text or the candidate is dropped (`sanitizePlanExtractDrafts`).
- Explicit study/preparation intent must be a separate `STUDY_STEP` (prompt + schema descriptions). Deadline uncertainty does not remove a homework obligation.
- Generation does not create plan rows. Apply is atomic per confirmation, retry-safe, and can skip or separately add likely duplicates (no silent merge).
- Body / transcript / accept-summary edits mark READY batches STALE. Entry delete cascades batches (and private excerpts). Approved plan rows are not deleted.
- Parent plan APIs never include extract batches, excerpts, or journal text.
- Deterministic tests cover sanitization/persistence; live provider quality is optional (`LIVE_PLAN_EXTRACT=1`) and separate from mocked integration tests.

**Correction (M6.1):** Live acceptance previously omitted `STUDY_STEP` for an explicit “çalışmam lazım” line — cause was **model omission**, not schema exclusion or excerpt rejection. Prompt/schema guidance updated; `sanitizePlanExtractDrafts` grounds `STUDY_STEP` / commitment types in excerpt wording (drops invented prep/homework when the excerpt does not support that type). Bounded live re-eval after the fix matched acceptance + contrasting fixtures. Do not treat the test stub as proof of live extraction quality.

Routes:

- Child: `GET/POST /api/child/journal/[id]/plan-extract`, `POST .../plan-extract/apply`
- UI: `/cocuk/gunluk/[id]/plan-oneri`
- Provider: `PlanExtractProvider` (OpenAI structured output; test stub when `GUNCE_AI_TEST_MODE` allows)

Migration: `20260910220000_plan_extract`.

## Child reminders + Web Push (Milestone 7)

| Concept | Model / piece | Notes |
|---------|---------------|-------|
| Prefs | `ChildReminderPreferences` | Off by default; journal time + study toggle + quiet hours; `revision` |
| Step reminder | `PlanStudyStep.reminderLocalTime` | Optional `HH:mm`; requires `plannedDate` |
| Device | `ChildPushSubscription` | Bound to child + session; endpoint unique; revoked on sign-out / parent revoke / push 410 |
| Outbox | `ReminderOccurrence` | Stable `occurrenceKey`; PENDING→CLAIMED→SENT/SKIPPED/EXPIRED/CANCELLED/FAILED; claim lease |
| Delivery | `ReminderDelivery` | Unique per occurrence+subscription (no routine duplicate device send) |
| Cap | `ReminderDayBucket` | Per child-local day sent count (max 3) |

Scheduler: `processDueReminders()` — materialize journal rows, claim due work, recheck prefs/status/journal existence, enforce grace + cap, send via injectable `PushAdapter`. Simultaneous study reminders share the stable tag `gunce-study-reminder` so the OS coalesces display; each accepted send still counts toward the daily cap.

Routes / commands:

- Child: `GET/PATCH /api/child/reminders`, `POST/PUT /api/child/reminders/push`
- Internal: `POST /api/internal/reminders/process` (`REMINDER_SCHEDULER_SECRET`)
- CLI: `npm run reminders:process`
- UI: `/cocuk/hatirlatmalar`; SW `/sw.js`; manifest `/manifest.webmanifest`

Migration: `20260911100000_reminders_web_push`.

## Daily experience UI (Milestone 8)

Presentation layer only:

- `ChildNav` fixed bottom bar on completed child routes (`Shell` `withChildNav` + `pb-28`)
- Child settings at `/cocuk/ayarlar` (reminders + sign-out); home hierarchy simplified
- Journal editor staged sections; list sharing labels distinguish private vs published
- Parent home prioritizes `ParentSharedSections` before compact plan/goals

No schema or domain service rewrite.

## Safe journal navigation (Milestone 8.1)

- `NavigationGuardProvider` + `GuardedLink` (`onClick` / `onNavigate`) intercept soft navigation while a journal text or voice guard is registered
- Text flush uses last successful persist + DOM sync; never reports success on failed/conflict writes; conflict offers stay/reload only (no force overwrite)
- Voice guard blocks on recording / between / finishing / review / recoverable in-memory audio; discard clears tracks, queues, and generation token so late STT cannot apply
- Tab close: `beforeunload` only (no reliable async save during unload)
- Browser Back: pushState sentinel + leave dialog/pipeline; not a substitute for a first-party App Router blocker API

## Authorization rules

1. Resolve session from httpOnly cookie via Better Auth.
2. Load membership / child profile using **session user id**.
3. Ignore client-supplied role / family / child / entry ids except as locators re-checked against ownership.

Children may only access `JournalEntry` / plan rows where `childId` matches their profile. Parents may only read non-withdrawn `PublishedShare` rows and read-only plan summaries for their family — never `JournalEntry.body`, transcripts, suggestions, plan-extract batches/excerpts, or plan write operations.

## Pairing (Milestone 1)

Hashed single-use invitations; redemption clears any existing device session then creates a child session.

## Test database safety

Integration and E2E suites must use database name `gunce_test`. Setup aborts before deletes if `current_database()` is not `gunce_test`.

## Explicitly not implemented yet

Production email provider (SMTP/API), requiring email verification for access, emotional scoring, chatbot, automatic scheduling of exams/goals, recurring study schedules, smartwatch integration, parent push/email/SMS notifications.
