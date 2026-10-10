import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/client/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client API requests", () => {
  it("does not declare JSON for a bodyless mutation", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api<void>("/api/jobs/job-1/cancel", { method: "POST" });

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("declares JSON when a mutation has a body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api<void>("/api/catalog/refresh", { method: "POST", body: JSON.stringify({ scope: "seasons" }) });

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("preserves an explicit content type", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api<void>("/api/example", {
      method: "POST",
      body: "plain text",
      headers: { "Content-Type": "text/plain" }
    });

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("Content-Type")).toBe("text/plain");
  });
});
