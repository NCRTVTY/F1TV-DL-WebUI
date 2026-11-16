import fs from "node:fs";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { patchSource } from "../scripts/patch-f1tv-dl.mjs";

const replacement = fs.readFileSync(new URL("../scripts/f1tv-token.cjs", import.meta.url), "utf8");
const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/f1tv-token.${name}.json`, import.meta.url), "utf8"));
const usernameSelector = 'input[name="username"], input[name="Login"]';
const passwordSelector = 'input[name="password"], input[name="Password"]';
const submitSelector = '#btnLogin';
const consentSelector = '#truste-consent-button, button[aria-label="Accept all"]';
const element = () => ({
  isVisible: vi.fn(async () => true),
  click: vi.fn(async () => {}),
  type: vi.fn(async (_value: string) => {})
});

type Cookie = { name: string; value: string; domain: string };
function harness() {
  const username = element();
  const password = element();
  const submit = element();
  const consent = element();
  let consentVisible = true;
  consent.click.mockImplementation(async () => { consentVisible = false; });
  const loginFrame = {
    url: vi.fn(() => "https://id.formula1.com/as/authorize"),
    $: vi.fn(async (selector: string) => {
      if (selector === usernameSelector) return username;
      if (selector === passwordSelector) return password;
      if (selector === submitSelector) return submit;
      return null;
    })
  };
  const consentFrame = {
    url: () => "https://consent.formula1.com/index.html",
    $: vi.fn(async (selector: string) => selector === consentSelector && consentVisible ? consent : null)
  };
  const untrustedFrame = {
    url: () => "https://untrusted.invalid/login",
    $: vi.fn(async (_selector: string) => username)
  };
  const signIn = element();
  const page = {
    setDefaultTimeout: vi.fn(),
    goto: vi.fn(async () => {}),
    waitForNavigation: vi.fn(async () => {}),
    $eval: vi.fn(async () => signIn.click()),
    frames: vi.fn(() => [untrustedFrame, consentFrame, loginFrame])
  };
  const cookies = vi.fn(async (): Promise<Cookie[]> => [
    { name: "entitlement_token", value: "provider result", domain: ".formula1.com" }
  ]);
  const browser = {
    newPage: vi.fn(async () => page),
    defaultBrowserContext: () => ({ cookies }),
    close: vi.fn(async () => {})
  };
  const launch = vi.fn(async () => browser);
  const module = { exports: {} as { getF1tvToken: (user: string, pass: string) => Promise<string> } };
  vm.runInNewContext(replacement, {
    module, URL, Date, setTimeout,
    require: (name: string) => {
      if (name === "./config") return { HEADLESS: true, BASE_URL: "https://f1tv.formula1.com", TOKEN_NETWORK_TIMEOUT: 1000 };
      if (name === "puppeteer-extra") return { launch, use: vi.fn() };
      if (name.startsWith("puppeteer-extra-plugin-")) return () => ({});
      throw new Error(`Unexpected module: ${name}`);
    }
  });
  return { ...module.exports, username, password, submit, consent, signIn, page, loginFrame,
    consentFrame, untrustedFrame, browser, launch, cookies };
}

afterEach(() => vi.useRealTimers());

describe("f1tv-dl compatibility patch", () => {
  it.each(["upstream", "v2"])("patches the exact %s source and is idempotent", (version) => {
    const patched = patchSource(fixture(version));
    expect(patched).toBe(replacement);
    expect(patchSource(patched)).toBe(patched);
  });

  it("rejects changed upstream source and incomplete or altered patches", () => {
    for (const source of [fixture("upstream") + "\n", fixture("v2").replace("finally", "else"), replacement.replace("await browser.close()", "await browser.disconnect()")]) {
      expect(() => patchSource(source)).toThrow("pinned authentication source changed");
    }
  });
});

describe("F1TV browser authentication", () => {
  it("dismisses iframe consent, submits the current trusted form, and returns the entitlement", async () => {
    const h = harness();
    await expect(h.getF1tvToken("account input", "password input")).resolves.toBe("provider result");
    expect(h.signIn.click).toHaveBeenCalledOnce();
    expect(h.consent.click).toHaveBeenCalledOnce();
    expect(h.username.type).toHaveBeenCalledWith("account input");
    expect(h.password.type).toHaveBeenCalledWith("password input");
    expect(h.loginFrame.$).toHaveBeenCalledWith(submitSelector);
    expect(h.submit.click).toHaveBeenCalledOnce();
    expect(h.untrustedFrame.$).not.toHaveBeenCalled();
    expect(h.browser.close).toHaveBeenCalledOnce();
  });

  it("waits through a redirect replacing the login document", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.loginFrame.$.mockRejectedValueOnce(new Error("Execution context destroyed"));
    const result = h.getF1tvToken("account input", "password input");
    const assertion = expect(result).resolves.toBe("provider result");
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
    expect(h.submit.click).toHaveBeenCalledOnce();
    expect(h.browser.close).toHaveBeenCalledOnce();
  });

  it("waits for a cookie after submission and ignores cookies from unrelated domains", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.cookies.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { name: "entitlement_token", value: "unrelated result", domain: "untrusted.invalid" }
    ]);
    const assertion = expect(h.getF1tvToken("account input", "password input")).resolves.toBe("provider result");
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(h.cookies).toHaveBeenCalledTimes(3);
    expect(h.browser.close).toHaveBeenCalledOnce();
  });

  it("times out without a token, reports a sanitized failure, and closes the browser", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.cookies.mockResolvedValue([]);
    const assertion = expect(h.getF1tvToken("account input", "password input")).rejects.toThrow("authentication failed while waiting for the entitlement token");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(h.browser.close).toHaveBeenCalledOnce();
  });

  it("does not submit account values to an HTTP login frame", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.loginFrame.url.mockReturnValue("http://id.formula1.com/as/authorize");
    const assertion = expect(h.getF1tvToken("account input", "password input")).rejects.toThrow("authentication failed while waiting for the sign-in form");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(h.username.type).not.toHaveBeenCalled();
    expect(h.password.type).not.toHaveBeenCalled();
    expect(h.browser.close).toHaveBeenCalledOnce();
  });

  it.each(["goto", "type"])("hides browser error details after a %s failure and closes Chromium", async (stage) => {
    const h = harness();
    const error = new Error("account input password input https://id.formula1.com/?state=private");
    if (stage === "goto") h.page.goto.mockRejectedValue(error);
    else h.password.type.mockRejectedValue(error);
    let message = "";
    try { await h.getF1tvToken("account input", "password input"); } catch (failure) { message = (failure as Error).message; }
    expect(message).toContain("F1TV authentication failed while");
    expect(message).not.toContain("account input");
    expect(message).not.toContain("password input");
    expect(message).not.toContain("https://");
    expect(message).not.toContain("private");
    expect(h.browser.close).toHaveBeenCalledOnce();
  });

  it("sanitizes browser launch failures", async () => {
    const h = harness();
    h.launch.mockRejectedValue(new Error("browser launch detail"));
    await expect(h.getF1tvToken("account input", "password input")).rejects.toThrow("authentication failed while opening the sign-in page");
    expect(h.browser.close).not.toHaveBeenCalled();
  });
});
