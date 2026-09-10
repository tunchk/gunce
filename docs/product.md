# Günce — Product context and milestones

## Audience

Children aged **9–14** and their parents.

## Promise to the child

> Tell us about your day. Let’s organize your week together.
>
> Turkish UI: “Gününü anlat. Haftanı birlikte düzenleyelim.”

Children describe their day by voice or text, edit the resulting summary, manage weekly plans, and work toward longer-term learning goals. Parents see **permitted** information that helps them support their child.

## Milestone 1 — Accounts, authorization, onboarding

**Status: implemented.**

- Real parent accounts (register / sign in / sign out)
- Family membership and server-side authorization
- Child profiles without requiring a child email address
- Parent-generated, expiring, single-use pairing invitations (hashed at rest)
- Child sessions scoped only to that child; parent session cleared on shared devices when entering the child experience
- Parent ability to revoke paired child sessions
- Short parent and child onboarding flows with resume and idempotent submissions
- Parent and child home screens with honest empty / “Yakında” states for later features
- PostgreSQL persistence, secure session cookies, CSRF-aware auth flows, rate limiting on auth and pairing

## Milestone 2 — Text journaling and child-controlled sharing

**Status: implemented.**

- Child writes about their day with optional prompts
- Private journal entry separate from parent-facing draft and published snapshot
- Optional support request (can be shared without sharing the journal body)
- Draft autosave with revision checks
- Explicit share / update share / withdraw share / delete
- Parent home shows excerpts of published messages with **Detayı gör**
- Parent detail shows the full approved message, the child’s support request, and labeled AI approach tips based only on published content
- Pairing and session management live under **Aile ayarları**
- Parents cannot edit child content; private text never appears in parent APIs or page data
- Withdrawal hides content from the app for the parent going forward; it cannot undo something already read. Republishing remains possible.

## Milestone 3 — Voice-assisted journaling and child-reviewed AI summaries

**Status: implemented in this repository.**

- Child chooses a prompt → types and/or records voice → reviews transcript → optionally requests “Yazımı toparla” → edits/accepts/discards the suggestion → saves privately → optional existing explicit sharing flow
- Browser audio capture only after an explicit child action; microphone purpose explained first
- Server-side transcription (OpenAI Audio Transcriptions); audio is not stored in the app database, object storage, logs, or analytics
- AI summaries are optional, separate from original text, labeled “Önerilen özet,” tied to a source revision, and never auto-publish
- Accepting a summary does not share with the parent; child may copy accepted summary into the sharing draft, then publish with the existing confirmation
- Failures leave private journaling usable; typed input remains available when voice/AI is unconfigured

**Out of scope for Milestone 3 (future):** weekly planning, tasks, goals, notifications, emotional scoring, general-purpose chatbot, full email verification / password recovery.

## Milestone 4 — Weekly planning (planned)

- “Haftama bak” and “Sıradaki adımım”
- Child-managed weekly plans
- Parent visibility of plan items the child adds (per product rules)

## Milestone 5 — Goals and parent support (planned)

- Longer-term learning goals
- Richer parent support views based on permitted shared data
- Notifications (opt-in, age-appropriate)

## Design principles

- Separate parent and child identities and sessions
- Never trust client-supplied `familyId`, `childId`, or role as authorization evidence
- No role-switch control that lets a child enter the parent area
- Minimize data collected (no exact birth date, school name, or home address in onboarding)
- Private journal text, audio, transcripts, and AI suggestions are never logged or exposed to parents automatically
- All user-facing interface text in Turkish
- Mobile-first, large touch targets, accessible forms
- Do not claim external provider retention policies unless independently verified
