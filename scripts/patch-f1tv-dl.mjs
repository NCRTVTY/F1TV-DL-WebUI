import fs from "node:fs";
import path from "node:path";

const tokenModule = path.resolve("node_modules/@thedave42/f1tv-dl/lib/f1tv-token.js");
const legacyDelay = "await page.waitForTimeout(getRandomInt(1000, 3000));";
const supportedDelay = "await new Promise(resolve => setTimeout(resolve, getRandomInt(1000, 3000)));";

if (!fs.existsSync(tokenModule)) {
  throw new Error("Cannot patch f1tv-dl: token module is missing");
}

const source = fs.readFileSync(tokenModule, "utf8");
if (source.includes(legacyDelay)) {
  fs.writeFileSync(tokenModule, source.replaceAll(legacyDelay, supportedDelay));
} else if (!source.includes(supportedDelay)) {
  throw new Error("Cannot patch f1tv-dl: expected login delay code was not found");
}
