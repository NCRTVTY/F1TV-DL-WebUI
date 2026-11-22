# Full-Season Event Grid Implementation Plan

## 1. Calendar adapter

- Add a Formula 1 calendar fetcher restricted to the official year-scoped racing page.
- Parse and normalize round, title, country, start date, and end date from untrusted calendar markup.
- Add sanitized fixtures for completed, current, and future rounds.

## 2. Event merge and cache

- Merge official schedule events with F1TV replay events, preferring round identity and defensive normalized-title matching.
- Add explicit `completed`, `current`, and `future` status plus replay availability to the event contract.
- Cache merged event results and preserve the existing stale-data fallback.
- Fall back to F1TV-only events if the schedule source is unavailable without a cached schedule.

## 3. API and client behavior

- Return the expanded event contract from the existing season-events endpoint.
- Replace the horizontal carousel with a responsive wrapping grid.
- Make completed events clickable, highlight the current weekend in blue, and disable future events.
- Select the current event automatically when it has F1TV sessions; otherwise select the latest completed event.

## 4. Verification and deployment

- Extend parser, merge, API, and client-state tests.
- Run type checks, tests, builds, dependency audit, Compose validation, production-container smoke tests, and responsive browser QA.
- Commit, pull without rebase, perform secret checks, push to `main`, monitor Drone, and verify the deployed application health and catalog endpoints.
