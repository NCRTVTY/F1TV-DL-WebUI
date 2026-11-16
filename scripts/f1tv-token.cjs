// F1TV-DL-WebUI authentication compatibility patch v3
const config = require('./config');
const puppeteer = require('puppeteer-extra');
puppeteer.use(require('puppeteer-extra-plugin-stealth')());
puppeteer.use(require('puppeteer-extra-plugin-adblocker')({ blockTrackers: true }));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const trustedHosts = new Set(['f1tv.formula1.com', 'account.formula1.com', 'id.formula1.com', 'static.formula1.com']);
const trustedFrame = (frame) => {
    try {
        const url = new URL(frame.url());
        return url.protocol === 'https:' && trustedHosts.has(url.hostname);
    } catch { return false; }
};

const dismissCookieConsent = async (page) => {
    for (const frame of page.frames()) {
        try {
            const url = new URL(frame.url());
            if (url.protocol !== 'https:' || !['consent.formula1.com', ...trustedHosts].includes(url.hostname)) continue;
            const button = await frame.$('#truste-consent-button, button[aria-label="Accept all"]');
            if (button && await button.isVisible()) await button.click();
        } catch { /* Consent frames can disappear during redirects. */ }
    }
};

const waitForLoginForm = async (page, timeout) => {
    const deadline = Date.now() + timeout;
    do {
        await dismissCookieConsent(page);
        for (const frame of page.frames().filter(trustedFrame)) {
            try {
                const username = await frame.$('input[name="username"], input[name="Login"]');
                const password = await frame.$('input[name="password"], input[name="Password"]');
                if (username && password && await username.isVisible() && await password.isVisible()) {
                    return { frame, username, password };
                }
            } catch { /* Retry when a redirect replaces the document. */ }
        }
        await sleep(250);
    } while (Date.now() < deadline);
    throw new Error('F1TV sign-in form did not become available');
};

const waitForEntitlement = async (browser, page, timeout) => {
    const deadline = Date.now() + timeout;
    do {
        const cookies = await browser.defaultBrowserContext().cookies();
        const token = cookies.find(cookie => cookie.name === 'entitlement_token' && cookie.value &&
            ['formula1.com', '.formula1.com', 'f1tv.formula1.com', '.f1tv.formula1.com'].includes(cookie.domain));
        if (token) return token.value;
        await dismissCookieConsent(page);
        await sleep(250);
    } while (Date.now() < deadline);
    throw new Error('F1TV sign-in did not issue an entitlement token; check the account or any required verification on F1TV');
};

const getF1tvToken = async (user, pass) => {
    let browser;
    let stage = 'opening the sign-in page';
    try {
        browser = await puppeteer.launch({
            headless: config.HEADLESS,
            args: ['--disable-web-security', '--window-size=1400,900', '--no-sandbox'],
            defaultViewport: { width: 1400, height: 900 }
        });
        const page = await browser.newPage();
        page.setDefaultTimeout(config.TOKEN_NETWORK_TIMEOUT);
        // Wait for the application's sign-in handler to hydrate before clicking it.
        await page.goto(config.BASE_URL, { timeout: config.TOKEN_NETWORK_TIMEOUT, waitUntil: 'networkidle0' });
        await Promise.all([
            page.waitForNavigation({ timeout: config.TOKEN_NETWORK_TIMEOUT, waitUntil: 'networkidle0' }),
            page.$eval('a[title="Sign in"]', element => element.click())
        ]);
        stage = 'waiting for the sign-in form';
        const { frame, username, password } = await waitForLoginForm(page, config.TOKEN_NETWORK_TIMEOUT);
        stage = 'submitting the sign-in form';
        await username.type(user);
        await password.type(pass);
        const submit = await frame.$('#btnLogin') || await frame.$('button.btn.btn-primary');
        if (!submit || !await submit.isVisible()) throw new Error('Sign-in button unavailable');
        await submit.click();
        stage = 'waiting for the entitlement token';
        return await waitForEntitlement(browser, page, config.TOKEN_NETWORK_TIMEOUT);
    } catch {
        // Browser errors may contain account values or OAuth URLs. Never forward them.
        throw new Error(`F1TV authentication failed while ${stage}; check the account or any required verification on F1TV`);
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
};

module.exports = { getF1tvToken };
