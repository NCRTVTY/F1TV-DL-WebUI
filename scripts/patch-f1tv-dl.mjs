import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultTokenModule = path.resolve("node_modules/@thedave42/f1tv-dl/lib/f1tv-token.js");
const patchMarker = "// F1TV-DL-WebUI authentication compatibility patch v2";
const legacyDelay = "await page.waitForTimeout(getRandomInt(1000, 3000));";
const supportedDelay = "await new Promise(resolve => setTimeout(resolve, getRandomInt(1000, 3000)));";

const legacyStart = `const getF1tvToken = async (user, pass) => {
    const debug = false;
    const browser = await puppeteer.launch({`;

const patchedStart = `const getF1tvToken = async (user, pass) => {
    const debug = false;
    let browser;
    try {
        browser = await puppeteer.launch({`;

const legacyConsent = `    await Promise.all([
        page.$eval('#truste-consent-button', el => el.click()),
        page.waitForSelector('#truste-consent-button', { timeout: 10000, hidden: true })
    ]);`;

const patchedConsent = "    await dismissCookieConsent(page);";

const legacyEnd = `    await browser.close();

    return loginSession.value;
}`;

const patchedEnd = `    if (!loginSession?.value) {
        throw new Error('F1TV login completed without an entitlement token');
    }

    return loginSession.value;
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}`;

const consentHelper = `${patchMarker}
const consentSelectors = [
    '#truste-consent-button',
    'button[aria-label="Accept all"]'
];

const dismissCookieConsent = async (page) => {
    const deadline = Date.now() + 10000;
    do {
        for (const frame of page.frames()) {
            for (const selector of consentSelectors) {
                try {
                    const button = await frame.$(selector);
                    if (button) {
                        await button.click();
                        return;
                    }
                } catch {}
            }
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
};

`;

function replaceExactlyOnce(source, search, replacement, description) {
  const first = source.indexOf(search);
  if (first === -1 || source.indexOf(search, first + search.length) !== -1) {
    throw new Error(`Cannot patch f1tv-dl: expected one ${description}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

export function patchSource(input) {
  let source = input.replaceAll(legacyDelay, supportedDelay);
  if (!source.includes(supportedDelay)) {
    throw new Error("Cannot patch f1tv-dl: expected login delay code was not found");
  }

  if (source.includes(patchMarker)) {
    const required = [
      "button[aria-label=\"Accept all\"]",
      "await dismissCookieConsent(page);",
      "catch {}",
      "finally {",
      "F1TV login completed without an entitlement token"
    ];
    if (!required.every((value) => source.includes(value))) {
      throw new Error("Cannot patch f1tv-dl: authentication patch is incomplete");
    }
    return source;
  }

  source = replaceExactlyOnce(source, legacyStart, patchedStart, "login browser launch");
  source = replaceExactlyOnce(source, legacyConsent, patchedConsent, "legacy consent block");
  source = replaceExactlyOnce(source, legacyEnd, patchedEnd, "login browser cleanup");
  source = replaceExactlyOnce(source, "const getF1tvToken", `${consentHelper}const getF1tvToken`, "login function");
  return source;
}

export function patchFile(filename = defaultTokenModule) {
  if (!fs.existsSync(filename)) {
    throw new Error("Cannot patch f1tv-dl: token module is missing");
  }
  const source = fs.readFileSync(filename, "utf8");
  const patched = patchSource(source);
  if (patched !== source) fs.writeFileSync(filename, patched);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) patchFile();
