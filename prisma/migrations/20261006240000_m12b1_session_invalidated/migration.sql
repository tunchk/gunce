-- M12B.1 UX: track when an accepted help session was invalidated/reopened.
ALTER TABLE "HelpRequest" ADD COLUMN "sessionInvalidatedAt" TIMESTAMP(3);
