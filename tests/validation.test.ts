import { describe, expect, it } from "vitest";
import { catalogDownloadSchema, catalogRefreshSchema } from "../src/server/validation";

describe("catalog command validation", () => {
  it("accepts server-owned event identifiers", () => {
    expect(catalogDownloadSchema.parse({ eventId: "p12343" })).toEqual({ eventId: "p12343" });
    expect(catalogDownloadSchema.parse({ eventId: "s616-m959" })).toEqual({ eventId: "s616-m959" });
  });

  it.each([
    "https://f1tv.formula1.com/detail/100/session",
    "p123;touch-bad",
    "../event"
  ])("rejects client-controlled or malformed identifier %s", (eventId) => {
    expect(catalogDownloadSchema.safeParse({ eventId }).success).toBe(false);
  });

  it("allows only known refresh scopes and matching identifiers", () => {
    expect(catalogRefreshSchema.safeParse({ scope: "seasons" }).success).toBe(true);
    expect(catalogRefreshSchema.safeParse({ scope: "events", id: "100" }).success).toBe(true);
    expect(catalogRefreshSchema.safeParse({ scope: "sessions", id: "p500" }).success).toBe(true);
    expect(catalogRefreshSchema.safeParse({ scope: "events", id: "p500" }).success).toBe(false);
  });
});
