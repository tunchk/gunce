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

**Status: implemented in this repository (no AI / no voice).**

- Child writes about their day with optional prompts
- Private journal entry separate from parent-facing draft and published snapshot
- Optional support request (can be shared without sharing the journal body)
- Draft autosave with revision checks
- Explicit share / update share / withdraw share / delete
- Parent home shows only published messages and support requests
- Parents cannot edit child content; private text never appears in parent APIs or page data

**Out of scope for Milestone 2 (future):** AI summarization, voice input, weekly planning, goals, notifications.

## Milestone 3 — Weekly planning (planned)

- “Haftama bak” and “Sıradaki adımım”
- Child-managed weekly plans
- Parent visibility of plan items the child adds (per product rules)

## Milestone 4 — Goals and parent support (planned)

- Longer-term learning goals
- Richer parent support views based on permitted shared data
- Notifications (opt-in, age-appropriate)

## Design principles

- Separate parent and child identities and sessions
- Never trust client-supplied `familyId`, `childId`, or role as authorization evidence
- No role-switch control that lets a child enter the parent area
- Minimize data collected (no exact birth date, school name, or home address in onboarding)
- Private journal text is never logged or exposed to parents
- All user-facing interface text in Turkish
- Mobile-first, large touch targets, accessible forms
