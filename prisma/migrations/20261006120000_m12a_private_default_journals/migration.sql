-- M12A: new journals are child-private by default.
-- Does not rewrite existing rows (historical GUARDIAN_VISIBLE keeps semantics).
ALTER TABLE "JournalEntry" ALTER COLUMN "visibility" SET DEFAULT 'LEGACY_PRIVATE';
