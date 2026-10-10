import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogService, parseEvents, parseSeasons, parseSessions } from "../src/server/catalog";
import { AppDatabase } from "../src/server/database";
import { archiveFixture, eventFixture, fixtureFetch, menuFixture, seasonFixture } from "./catalog-fixtures";

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
