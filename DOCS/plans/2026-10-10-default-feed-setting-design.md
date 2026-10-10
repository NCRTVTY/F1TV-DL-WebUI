# Default Feed Setting Design

## Goal

Make the default download feed easy to change while ensuring F1TV's `F1 LIVE` feed is the initial default. Existing queued downloads must follow the configured default without changing running or historical jobs.

## Design

Store the preferred feed as a non-secret SQLite setting with two supported values: `F1 LIVE` and `INTERNATIONAL`. When no setting exists, the server uses and persists `F1 LIVE`.

Expose the preference through the existing settings API and add a selector to the Settings page. The server remains authoritative: catalog download requests do not accept a feed value and instead read the stored preference when creating a job.

Changing the preference saves the new value and updates every job still in `queued` status in the same database transaction. Running, completed, failed, and cancelled jobs keep their recorded feed. On startup, the database migration initializes the preference to `F1 LIVE` and updates all currently queued jobs to that value, covering jobs created before this feature is deployed.

The Sessions view shows the active default next to the fixed best-quality and English-audio defaults. Queue cards continue to show the feed recorded for each individual job.

## Validation and Error Handling

The settings endpoint accepts only the two supported feed values. Invalid values return a client error without modifying either the stored preference or queued jobs. The existing credential setting behavior remains unchanged.

## Verification

Add database tests for initial migration and transactional queued-job updates, including preservation of non-queued jobs. Add API tests for reading and changing the preference, invalid values, and new-job defaults. Update client-facing copy and README documentation, then run type checks, the complete test suite, and the production build.
