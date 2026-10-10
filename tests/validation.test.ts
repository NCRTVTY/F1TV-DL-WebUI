import { describe, expect, it } from "vitest";
import { createJobSchema } from "../src/server/validation";

describe("download validation", () => {
  it("accepts F1 TV detail URLs and supplies safe defaults", () => {
    const result = createJobSchema.parse({ url: "https://f1tv.formula1.com/detail/100000/example-session" });
    expect(result).toMatchObject({ quality: "best", audio: "eng" });
  });

  it.each([
    "https://example.com/detail/100000/example-session",
    "http://f1tv.formula1.com/detail/100000/example-session",
    "https://f1tv.formula1.com/page/home"
  ])("rejects unsafe or unsupported URL %s", (url) => {
    expect(createJobSchema.safeParse({ url }).success).toBe(false);
  });

  it("rejects values that could become arbitrary command arguments", () => {
    const result = createJobSchema.safeParse({
      url: "https://f1tv.formula1.com/detail/100000/example-session",
      quality: "best; touch bad",
      audio: "unknown"
    });
    expect(result.success).toBe(false);
  });
});
