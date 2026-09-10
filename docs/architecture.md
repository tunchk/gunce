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

### Email verification

`User.emailVerified` defaults to `false`. This milestone does **not** set it to `true` on registration and does not implement a verification email flow. Local sign-in works with unverified email because Better Auth `requireEmailVerification` is not enabled. Treat any production verification as a future feature.

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

## Authorization rules

1. Resolve session from httpOnly cookie via Better Auth.
2. Load membership / child profile using **session user id**.
3. Ignore client-supplied role / family / child / entry ids except as locators re-checked against ownership.

Children may only access `JournalEntry` rows where `childId` matches their profile. Parents may only read non-withdrawn `PublishedShare` rows for their family — never `JournalEntry.body`, transcripts, or suggestions.

## Pairing (Milestone 1)

Hashed single-use invitations; redemption clears any existing device session then creates a child session.

## Test database safety

Integration and E2E suites must use database name `gunce_test`. Setup aborts before deletes if `current_database()` is not `gunce_test`.

## Explicitly not implemented yet

Weekly planning, goals, notifications, email verification, password recovery, emotional scoring, chatbot.
