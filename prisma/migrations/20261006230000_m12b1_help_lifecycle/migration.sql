-- M12B.1: help lifecycle notification kinds (no table shape change).
ALTER TYPE "AppNotificationKind" ADD VALUE 'HELP_OFFER_UPDATED';
ALTER TYPE "AppNotificationKind" ADD VALUE 'HELP_OFFER_WITHDRAWN';
ALTER TYPE "AppNotificationKind" ADD VALUE 'HELP_ACCEPTED_CANCELLED';
ALTER TYPE "AppNotificationKind" ADD VALUE 'HELP_REQUEST_REOPENED';
