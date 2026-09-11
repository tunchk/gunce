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

**Out of scope for Milestone 3 (future):** goals, notifications, emotional scoring, general-purpose chatbot, full email verification / password recovery.

## Milestone 4 — Weekly planning (current)

- Child-owned weekly plan: homework, exams, courses/activities, and study/preparation steps
- Distinguish commitments (due/event dates) from study steps (planned date + optional estimated minutes)
- Study steps may link to homework/exam or stand alone; moving a step never changes the related deadline
- Completing preparation does not complete homework/exam; passing event dates do not auto-complete
- Child home: functional **Sıradaki adımım** (today’s next incomplete study step) and **Haftama bak**
- **Haftam**: Monday–Sunday, week navigation, mobile day selector, unscheduled + missed steps
- **Plan ekle**: type first, then relevant fields; optional prep after homework/exam
- Parent: concise **Haftanın planı** + read-only week view; APIs reject parent writes
- Planning visibility is separate from journal sharing; parent plan APIs never include journal text/transcripts/summaries
- First-use notice: “Planına eklediğin işleri velin de görebilir.”

### Milestone 4.1 — Study-step board (current)

- Same `PlanStudyStep` records as the week view (no parallel task system)
- View selector: **Hafta** / **Pano**; week navigation preserved across views
- Board columns: **Yapılacak** / **Yapıyorum** / **Tamamladım** (desktop side-by-side; mobile tabs)
- Study-step workflow status: `TODO` | `IN_PROGRESS` | `DONE` (single source of truth; migrated from former completion boolean)
- Optional `completedAt` on study steps is metadata only (set when entering DONE; cleared when leaving; not used to decide columns)
- Commitments stay separate; unscheduled + previous-day leftovers remain accessible
- Next-step on home prefers today’s **Yapıyorum**, then **Yapılacak**
- Parent read-only plan shows Turkish status labels; no parent writes

**Known data limitation:** After `20260910190000_study_step_status` dropped study-step completion timestamps, re-adding `completedAt` (`20260910200000_study_step_completed_at_metadata`) leaves existing DONE rows with `completedAt = null`. New completions record server time going forward.

**Out of scope for Milestone 4 / 4.1:** AI task extraction, automatic scheduling, recurring schedules, push notifications, smartwatch integration, drag-and-drop, workload health claims.

## Milestone 5 — Long-term goals

- Child-owned goals with title, optional outcome description, optional target date
- Lifecycle: **ACTIVE** / **ACHIEVED** / **ARCHIVED** (independent of study-step workflow)
- Linked study steps are the same `PlanStudyStep` records used by Hafta and Pano (optional `relatedGoalId`)
- Progress = DONE linked steps / total linked steps (never fake 100% with zero steps; not mastery)
- Completing all steps does **not** auto-achieve the goal; child chooses **Hedefime ulaştım**
- Archive/delete preserve steps; delete only removes the goal link
- Child UI: **Hedeflerim**; first-use notice that parents can see goals and their steps
- Parent: read-only list/detail; write APIs rejected; no journal content in goal payloads

**Out of scope for Milestone 5:** AI goal generation, recurrence, notifications, smartwatch, mastery scoring.

## Milestone 6 — Journal → plan suggestions

- Optional **Planıma neler ekleyebilirim?** on the journal entry (after save)
- Uses the saved, child-reviewed narrative (not unreviewed audio; not the AI summary as a substitute)
- AI returns grounded **candidates** only (homework / exam / course / study step) with supporting excerpts validated against the source
- **Explicit study/preparation intent** (e.g. “çalışmam lazım”) must yield a separate `STUDY_STEP` candidate — not only the related exam/homework
- Deadline uncertainty (“teslim tarihini bilmiyorum”) keeps the homework candidate with uncertain date; it does not drop the obligation
- Child reviews editable cards (initially unselected), confirms dates, then **Seçtiklerimi planıma ekle**
- Notice: “Planına eklediklerini velin de görebilir. Günlük yazın paylaşılmaz.”
- Application creates the same `PlanCommitment` / `PlanStudyStep` records; generation never mutates the plan
- Batches tied to source revision; edits stale unapplied suggestions; entry delete cascades private batches/excerpts
- Already applied plan items remain independent of later journal/share edits
- Parents never see candidate batches, excerpts, or provenance; plan APIs stay approved fields only

**Provider note (Milestone 6.1 correction):** An earlier live acceptance run returned exam + homework but omitted the explicit preparation sentence as a `STUDY_STEP`. Investigation showed the **model omitted it** (structured schema already allowed `STUDY_STEP`; sanitization did not drop a prep candidate that was never returned). Prompts and schema descriptions were tightened so explicit study/prep intent yields a separate `STUDY_STEP`. Sanitization also grounds candidate types in excerpt wording (filters invented prep on exam-only lines and invented homework on study-only lines — not keyword task generation). After correction, a bounded live eval (`LIVE_PLAN_EXTRACT=1`) matched expected types for the acceptance example and the six contrasting fixtures. Stub tests still do not substitute for live provider checks.

**Out of scope for Milestone 6:** automatic scheduling, recurrence, notifications, smartwatch, automatic goal creation.

## Milestone 7 — Child reminders + Web Push (current)

- Optional **Hatırlatmalar** settings (off by default): daily journal invitation time, global study-step reminders, quiet hours (default 21:00–08:00)
- Browser permission only after **Bu cihazda bildirimleri aç**; distinguishes app prefs / permission / device registration
- Daily journal copy: “Gününden bir şey anlatmak ister misin?” — at most once per child-local day; skipped if a non-empty saved narrative exists (sharing not required; no journal content in the decision path or push payload)
- Study-step reminders: optional `reminderLocalTime` + `plannedDate`; not estimatedMinutes; DONE/IN_PROGRESS suppressed; delete/reschedule updates occurrences; title edit does not duplicate
- Durable PostgreSQL outbox (`ReminderOccurrence` + per-device `ReminderDelivery`); process via `npm run reminders:process` or authenticated `POST /api/internal/reminders/process`
- Web Push (VAPID); generic lock-screen text only; click opens child routes requiring a valid session
- Policies: quiet-hours defer/skip, 30-minute grace (no backlog), daily cap of 3, DST gap/overlap rules, child time zone
- iOS: Home Screen install guidance when relevant; localhost does not prove real-phone/closed-app delivery

**Out of scope for Milestone 7:** parent notifications, email/SMS, recurring study tasks, smartwatch, automatic exam/goal notifications.

## Design principles

- Separate parent and child identities and sessions
- Never trust client-supplied `familyId`, `childId`, or role as authorization evidence
- No role-switch control that lets a child enter the parent area
- Minimize data collected (no exact birth date, school name, or home address in onboarding)
- Private journal text, audio, transcripts, and AI suggestions are never logged or exposed to parents automatically
- All user-facing interface text in Turkish
- Mobile-first, large touch targets, accessible forms
- Do not claim external provider retention policies unless independently verified
