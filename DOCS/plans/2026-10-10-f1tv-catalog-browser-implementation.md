# F1TV Catalog Browser Implementation Plan

## 1. Provider adapter and contracts

- Add normalized `Season`, `Event`, and `CatalogSession` contracts.
- Add a fetch-based F1TV adapter that discovers the current season from the menu and older seasons from the archive.
- Parse season pages into non-test Formula 1 Grand Prix events.
- Parse each event's replay rail, filtering to Formula 1 practice, qualifying, sprint qualifying, sprint, and race sessions.
- Validate provider IDs and canonicalize only `https://f1tv.formula1.com/detail/...` URLs.
- Add sanitized fixtures and parser tests, including malformed responses and content exclusions.

## 2. Cache and server-owned lookup

- Add a JSON catalog cache backed by the existing SQLite settings store with timestamps and a short TTL.
- Preserve the last successful entry when refresh fails and report stale state.
- Build a catalog service that performs cached season/event/session reads and explicit refreshes.
- Ensure job creation resolves content IDs through cached or freshly fetched server data; never accept a client URL.

## 3. Queue integration

- Extend job metadata with provider content ID and display title using a backward-compatible database migration.
- Add duplicate detection for queued, running, and completed catalog sessions.
- Queue best-quality, English-audio jobs with `channel = INTERNATIONAL` by default.
- Preserve existing durable worker, cancellation, MP4 output, Range serving, and credential isolation.

## 4. HTTP API

- Add endpoints for seasons, season events, event sessions, catalog refresh, and catalog-session download.
- Validate all path/body identifiers and return provider, stale-cache, eligibility, credential, and duplicate errors distinctly.
- Keep the old generic URL-based job route unavailable to the browser and remove it once catalog tests cover the replacement.

## 5. Client catalog experience

- Replace the manual URL form with season selection, event cards, and session cards.
- Select the dynamically marked current season on initial load.
- Show replay metadata, availability, cache freshness, refresh state, and existing queue/download state.
- Make the main action one-click `Download MP4`; show that it uses Best quality, English audio, and INTERNATIONAL feed.
- Retain responsive tablet/phone behavior and the existing Queue, Downloads, and Settings tabs.

## 6. Verification and deployment

- Add API integration tests for browse, refresh, one-click queueing, duplicate prevention, and INTERNATIONAL defaults.
- Run type checks, unit/API tests, production builds, dependency audit, Compose validation, and a production container smoke test.
- Perform responsive browser QA against representative sanitized catalog fixtures.
- Commit, pull without rebase, repeat secret checks, and push to `main`.
- Monitor the Drone pipeline through the Harlem health gate and confirm the deployed commit and live catalog endpoint.
