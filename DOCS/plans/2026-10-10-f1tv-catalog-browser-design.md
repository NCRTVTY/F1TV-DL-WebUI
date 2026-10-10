# F1TV Catalog Browser Design

## Goal

Replace manual F1TV session URL entry with a first-class Formula 1 catalog browser. A configured F1TV account should let the user browse seasons, Grand Prix events, and completed Formula 1 sessions, then queue an MP4 download with one click. The current season must always be present and selected by default; archived seasons remain available.

## Scope

The catalog includes Formula 1 race-weekend content only:

- Practice sessions
- Qualifying
- Sprint qualifying
- Sprints
- Races

Formula 2, Formula 3, F1 Academy, highlights, press conferences, pre/post-race shows, analysis, documentaries, and F1 Kids are excluded. Upcoming and live sessions may remain visible for context, but only completed replays can be queued.

The manual URL form is removed. The server derives every download URL from F1TV catalog responses. If the catalog integration fails, the application reports the problem and offers a refresh; it does not ask the user for a URL.

## Catalog Architecture

A dedicated server-side F1TV catalog adapter consumes the same structured JSON endpoints used by the F1TV web application:

1. Read the F1TV menu to discover the current-season page dynamically.
2. Read the archive page to discover older season pages.
3. Read the selected season page to discover its Grand Prix event pages.
4. Read an event page and select its replay collection.
5. Normalize and filter the returned items to supported Formula 1 session types.

The adapter validates every upstream response at runtime. It accepts only HTTPS links on `f1tv.formula1.com`, converts relative detail links to canonical URLs internally, and never forwards arbitrary provider URLs to the downloader.

Catalog browsing does not require account credentials because the metadata is publicly available. Encrypted F1TV credentials remain required when a download worker resolves the entitled stream.

## Cache and API

Normalized catalog data is cached in SQLite with its fetch time and upstream source identity. The cache reduces provider load and lets the UI retain the last successful result during a temporary outage. A normal read uses a short time-to-live; an explicit Refresh action bypasses that TTL. A failed refresh preserves the previous cache and returns a clear stale-data warning.

The application exposes server-owned endpoints for:

- Listing seasons, including the dynamically discovered current season
- Listing events for a season
- Listing supported sessions for an event
- Refreshing catalog data
- Queueing a selected catalog session by its provider content ID

The client never supplies a download URL. The queue endpoint looks up the selected normalized session on the server, verifies that it is a completed replay, prevents duplicate active/completed jobs, and then creates the existing durable job.

## User Experience

The Sessions tab becomes a catalog browser:

- Current season selected by default, with archived seasons in a selector
- Grand Prix cards ordered by round, with completed/current events easy to find
- Session cards showing session type, date, duration, availability, and thumbnail where supplied
- A visible Refresh control and cache freshness indicator
- One-click **Download MP4** for available replays

The primary action queues best available video quality, English audio, and the **INTERNATIONAL** F1TV feed by default. This selection is explicit in the job record and downloader arguments. Sessions already queued, running, or completed show that state rather than a second download button. Completed jobs remain downloadable or playable from the Downloads tab using the existing range-enabled file endpoint.

## Failure Handling

Provider timeouts, network failures, and response-shape changes are reported separately from entitlement or download failures. A catalog failure does not delete the last successful cache. A selected session is revalidated from server-owned catalog data before queueing. Authentication expiry or unavailable entitlement fails the job with a sanitized message and does not expose credentials, cookies, tokens, signed stream URLs, or provider response bodies.

## Security

- Credentials stay encrypted at rest and are used only by the download worker.
- Catalog requests never contain F1TV credentials.
- Only exact allowlisted F1TV hosts and paths are accepted.
- Provider metadata is treated as untrusted input, length-limited, normalized, and rendered as text.
- No credentials, entitlement tokens, cookies, signed playback URLs, or private response data are logged or returned to the browser.
- Existing `/SECRETS/` ignore and pre-commit secret checks remain mandatory.

## Testing and Deployment

Sanitized provider fixtures cover current-season discovery, archived-season parsing, event extraction, session normalization, F1-only filtering, replay eligibility, malformed responses, stale-cache fallback, duplicate prevention, and internal URL derivation. API and client tests cover the complete browsing and one-click queue flow, including the INTERNATIONAL feed default and completed MP4 retrieval.

Drone remains the only deployment path. Its verification stage runs type checks, unit/API tests, and production builds. A live public-catalog smoke check verifies that the deployed adapter can discover the current season without using account credentials. The existing commit and writable-storage health gate remains in place for Harlem.
