# Günce — Architecture

## Stack

- **Next.js 15** (App Router) + **TypeScript** + **React 19**
- **PostgreSQL** via **Prisma ORM** (Homebrew `postgresql@15` recommended locally; Docker optional)
- **Better Auth** for email/password parent authentication and database-backed sessions
- **Vitest** integration tests on `gunce_test` only
- **Playwright** browser E2E on `gunce_test` (optional; requires Chromium install)

## Identity model (Milestone 1)

| Actor  | Auth user                         | App records                                      |
|--------|-----------------------------------|--------------------------------------------------|
| Parent | Better Auth `User` (`role=PARENT`)| `FamilyMembership` → `Family` → `ChildProfile`s |
| Child  | Better Auth `User` (`role=CHILD`) | `ChildProfile.userId` (synthetic email, never shown) |

## Journal & sharing model (Milestone 2)

Private writing and parent-visible content are separate records:

| Concept | Model | Notes |
|---------|-------|-------|
| Private journal | `JournalEntry` | `body` is child-only; never returned by parent APIs |
| Parent-facing draft | `SharingDraft` | Independent `parentMessage` + `supportRequest`; editable without publishing |
| Published snapshot | `PublishedShare` | Approved copy parents can read; soft-withdrawn via `withdrawnAt` |

Semantics:

- New entries are private by default.
- Editing `JournalEntry.body` does not change `PublishedShare`.
- Editing `SharingDraft` does not change an existing published snapshot until the child publishes again (“Paylaşımı güncelle”).
- Withdrawal sets `withdrawnAt`; subsequent parent queries exclude the row.
- Deleting a `JournalEntry` cascades drafts and published shares.
- Optimistic concurrency via `revision` / `expectedRevision` on body and draft updates.
- Retry-safe create via optional unique `clientRequestId`.
- Parent list/detail APIs send `Cache-Control: private, no-store`.

## Authorization rules

1. Resolve session from httpOnly cookie via Better Auth.
2. Load membership / child profile using **session user id**.
3. Ignore client-supplied role / family / child / entry ids except as locators re-checked against ownership.

Children may only access `JournalEntry` rows where `childId` matches their profile. Parents may only read non-withdrawn `PublishedShare` rows for their family — never `JournalEntry.body`.

## Pairing (Milestone 1)

Hashed single-use invitations; redemption clears any existing device session then creates a child session.

## Test database safety

Integration and E2E suites must use database name `gunce_test`. Setup aborts before deletes if `current_database()` is not `gunce_test`.

## Explicitly not implemented yet

AI summarization, voice capture, weekly planning, goals, notifications, email verification, password recovery.
