import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogService, mergeCalendarEvents, parseCalendar, parseEvents, parseSeasons, parseSessions } from "../src/server/catalog";
import { AppDatabase } from "../src/server/database";
import { archiveFixture, calendarFixture, eventFixture, fixtureFetch, menuFixture, seasonFixture } from "./catalog-fixtures";

const directories: string[] = [];
const now = new Date("2026-10-10T12:00:00Z");

function database(): AppDatabase {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-catalog-"));
  directories.push(directory);
  return new AppDatabase(path.join(directory, "catalog.sqlite"));
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("F1TV catalog normalization", () => {
  it("discovers and marks the current season while retaining archive seasons", () => {
    expect(parseSeasons(menuFixture, archiveFixture)).toEqual([
      { id: "100", year: 2026, title: "2026 Season", current: true },
      { id: "99", year: 2025, title: "2025 Season", current: false }
    ]);
  });

  it("extracts race weekends and excludes non-event material", () => {
    const season = { id: "100", year: 2026, title: "2026 Season", current: true };
    expect(parseEvents(seasonFixture, season, now)).toEqual([expect.objectContaining({
      id: "p500", round: 1, country: "Australia", complete: true
    })]);
    const localizedTitle = JSON.parse(JSON.stringify(seasonFixture).replace("GRAND PRIX", "GRAN PREMIO")) as unknown;
    expect(parseEvents(localizedTitle, season, now)).toHaveLength(1);
  });

  it("merges the complete calendar with replay events and marks event states", () => {
    const season = { id: "100", year: 2026, title: "2026 Season", current: true };
    const calendar = parseCalendar(calendarFixture, 2026);
    expect(calendar.map((event) => event.round)).toEqual([1, 17, 18, 23]);

    const merged = mergeCalendarEvents(season, parseEvents(seasonFixture, season, now), calendar, now);
    expect(merged).toHaveLength(4);
    expect(merged[0]).toMatchObject({ id: "p500", status: "completed", replayAvailable: true });
    expect(merged[1]).toMatchObject({ id: "c2026-r17", status: "current", replayAvailable: false });
    expect(merged[2]).toMatchObject({ status: "future", replayAvailable: false });
  });

  it("keeps only supported Formula 1 replays and derives a canonical URL", () => {
    const sessions = parseSessions(eventFixture, "p500", now, undefined, 2026);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: "700", type: "Race", available: true });
    expect(sessions[0]?.url).toBe("https://f1tv.formula1.com/detail/700/2026-australian-grand-prix");
  });

  it("serves stale cached data if a provider refresh fails", async () => {
    const db = database();
    const service = new CatalogService(db, fixtureFetch, () => now);
    const fresh = await service.seasons();
    expect(fresh.stale).toBe(false);

    const failed = new CatalogService(db, async () => { throw new Error("provider unavailable"); }, () => new Date(now.getTime() + 16 * 60 * 1000));
    const stale = await failed.seasons();
    expect(stale).toMatchObject({ data: fresh.data, stale: true, warning: "provider unavailable" });
    db.close();
  });
});
