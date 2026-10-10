import { describe, expect, it } from "vitest";
import { patchSource } from "../scripts/patch-f1tv-dl.mjs";

const legacySource = `const getF1tvToken = async (user, pass) => {
    const debug = false;
    const browser = await puppeteer.launch({
        headless: true
    });
    await Promise.all([
        page.$eval('#truste-consent-button', el => el.click()),
        page.waitForSelector('#truste-consent-button', { timeout: 10000, hidden: true })
    ]);
    await page.waitForTimeout(getRandomInt(1000, 3000));
    const loginSession = cookies.find(el => el.name == 'entitlement_token');
    await browser.close();

    return loginSession.value;
}
`;

describe("f1tv-dl compatibility patch", () => {
  it("supports current iframe consent and always closes Chromium", () => {
    const patched = patchSource(legacySource);

    expect(patched).toContain('button[aria-label="Accept all"]');
    expect(patched).toContain("for (const frame of page.frames())");
    expect(patched).toContain("catch {}");
    expect(patched).toContain("await dismissCookieConsent(page);");
    expect(patched).toContain("finally {");
    expect(patched).toContain("if (browser) await browser.close().catch(() => {});");
    expect(patched).toContain("F1TV login completed without an entitlement token");
    expect(patched).not.toContain("page.waitForTimeout");
    expect(patchSource(patched)).toBe(patched);
  });

  it("fails closed when the pinned login source changes", () => {
    expect(() => patchSource("const getF1tvToken = async () => {}"))
      .toThrow(/expected login delay code/);
  });
});
