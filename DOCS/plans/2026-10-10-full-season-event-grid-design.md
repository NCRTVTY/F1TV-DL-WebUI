# Full-Season Event Grid Design

## Goal

Show every Formula 1 race weekend in the selected current season without requiring horizontal scrolling. Completed weekends remain available for replay browsing, the active weekend is visually prominent, and future weekends are visible but disabled.

## Data model and sources

The server will merge two Formula 1-owned sources:

- The official Formula 1 season calendar supplies the complete ordered schedule, including future rounds.
- The existing F1TV catalog supplies replay event identifiers and downloadable sessions.

The normalized event model will expose an explicit status: `completed`, `current`, or `future`. It will also distinguish events backed by an F1TV replay page from schedule-only future events. Matching will prefer round number and use normalized country/title data as a defensive fallback. Archived seasons will continue to use F1TV data directly because their complete replay catalogs are already available.

If the official calendar cannot be refreshed, the application will retain its cached merged result. If no schedule cache exists, it will fall back to the F1TV event list instead of making the catalog unusable.

## Interface

The horizontal event carousel will become a responsive wrapping grid so every round is immediately visible.

- Completed cards are clickable and labeled `Replay available`.
- The weekend containing the current date receives a blue treatment and the label `This weekend`. It is selected automatically when its F1TV event page exists.
- Future cards are muted, labeled `Future`, show their dates, and are disabled.
- A schedule-only current event may be highlighted but remains disabled until F1TV publishes the corresponding event page.
- For seasons without an active weekend, the newest completed event remains the default selection.

Session browsing and downloads remain unchanged: only server-discovered completed F1TV replays can be queued, using best quality, English audio, and the `INTERNATIONAL` feed.

## Security and failure handling

The new schedule fetch is restricted to exact HTTPS Formula 1 hosts and a year-scoped calendar path. Calendar markup is treated as untrusted input, normalized, length-limited, and never executed. The browser still receives no provider download URLs.

## Verification

Fixtures will cover schedule parsing, merge behavior, all three event states, current-weekend selection, future-event disabling, archived-season fallback, stale-cache behavior, and mobile/desktop wrapping. The existing unit, API, build, container, secret, and Drone deployment checks remain mandatory.
