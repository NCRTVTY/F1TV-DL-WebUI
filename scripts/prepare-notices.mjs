import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public", "licenses");
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const mplSources = JSON.parse(fs.readFileSync(path.join(root, "LICENSES", "mpl-sources.json"), "utf8"));
const legacy = {
  "async@0.2.10": "packaged package.json.licenses and LICENSE",
  "dom-walk@0.1.2": "packaged package.json.licenses",
  "log-prefix@0.1.1": "packaged README License section",
  "log-timestamp@0.3.0": "packaged README License section",
};

const packages = Object.entries(lock.packages).filter(([location]) => location).map(([location, item]) => {
  const name = location.split("node_modules/").at(-1);
  const key = name + "@" + item.version;
  const license = item.license || (legacy[key] ? "MIT" : undefined);
  if (!license) throw new Error("Review missing license declaration for " + key);
  const record = { name, version: item.version, license, development: Boolean(item.dev), optional: Boolean(item.optional) };
  if (legacy[key]) record.declarationSource = legacy[key];
  if (license === "MPL-2.0") {
    const source = mplSources.find(s => s.name === name && s.version === item.version);
    if (!source?.sourceUrl || !/^[a-f0-9]{40}$/.test(source.commit))
      throw new Error("Record exact MPL source provenance for " + key);
    record.sourceUrl = source.sourceUrl;
    record.sourceLicense = "MPL-2.0";
  }
  return record;
}).sort((a, b) => (a.name + "@" + a.version).localeCompare(b.name + "@" + b.version));

const files = [
  ["LICENSE", "project-MIT.txt"],
  ["THIRD_PARTY_NOTICES.md", "third-party-notices.md"],
  ["LICENSES/f1tv-dl-ISC.txt", "f1tv-dl-ISC.txt"],
  ["LICENSES/mpl-sources.json", "mpl-sources.json"],
  ["node_modules/react/LICENSE", "react-MIT.txt"],
  ["node_modules/react-dom/LICENSE", "react-dom-MIT.txt"],
  ["node_modules/lucide-react/LICENSE", "lucide-ISC-and-Feather-MIT.txt"],
  ["node_modules/@fontsource/barlow/LICENSE", "barlow-OFL-1.1.txt"],
  ["node_modules/@fontsource/barlow-condensed/LICENSE", "barlow-condensed-OFL-1.1.txt"],
  ["node_modules/@cliqz/adblocker/LICENSE", "MPL-2.0.txt"],
  ["node_modules/caniuse-lite/LICENSE", "caniuse-lite-CC-BY-4.0.txt"],
];
// Read everything before writing, so a missing dependency fails the build clearly.
const contents = files.map(([source, target]) => [target, fs.readFileSync(path.join(root, source))]);
fs.mkdirSync(output, { recursive: true });
for (const [target, content] of contents) {
  const value = target === "third-party-notices.md"
    ? content.toString("utf8").replaceAll("](LICENSE)", "](project-MIT.txt)").replaceAll("](LICENSES/", "](")
    : content;
  fs.writeFileSync(path.join(output, target), value);
}
fs.writeFileSync(path.join(output, "dependencies.json"), JSON.stringify({ scope: "Complete lockfile, including development and optional platform packages; third-party licenses remain in force", packages }, null, 2) + "\n");
const links = [...files.map(([, target]) => target), "dependencies.json"];
fs.writeFileSync(path.join(output, "index.html"), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>F1TV-DL-WebUI licenses</title><h1>Licenses and third-party notices</h1><p>The original application is MIT. Third-party software, fonts and content keep their own terms. See the notices for scope and source obligations.</p><ul>' + links.map(target => '<li><a href="' + target + '">' + target + '</a></li>').join("") + '</ul></html>\n');
console.log("Prepared project and third-party notices for " + packages.length + " locked packages");
