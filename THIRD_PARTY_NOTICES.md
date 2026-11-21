# License scope and third-party notices

The original F1TV-DL-WebUI application code, original documentation and original
contributions are licensed under the root [MIT license](LICENSE), copyright
2026 Ronny Welter. This grant does not relicense third-party code, fonts, images,
trademarks, provider data, broadcasts or downloaded media.

## Application dependencies

The pinned dependency graph was reviewed on 2026-11-21. Its declared licenses do
not require changing the original application to GPL. This is a compatibility
assessment for the current architecture, not a claim that every bundled item is
MIT or that all public-release obligations have already been discharged.

| Direct runtime dependency | Version | Declared license |
| --- | --- | --- |
| @fastify/static | 10.1.6 | MIT |
| @fontsource/barlow | 5.3.0 | OFL-1.1 |
| @fontsource/barlow-condensed | 5.3.0 | OFL-1.1 |
| @thedave42/f1tv-dl | 0.25.18-alpha.0 | ISC |
| better-sqlite3 | 12.4.1 | MIT |
| fastify | 5.12.5 | MIT |
| lucide-react | 1.76.0 | ISC, with inherited MIT Feather notices |
| react | 19.2.0 | MIT |
| react-dom | 19.2.0 | MIT |
| zod | 4.1.12 | MIT |

Keep the license and copyright files supplied with npm packages. Do not replace
them with this project's MIT notice. `npm run licenses` produces the complete
lockfile inventory, including development and optional platform packages, at
`public/licenses/dependencies.json`. The production client build includes it at
`/licenses/dependencies.json` and exposes notices at `/licenses/index.html`.

Four older packages omit the lockfile's `license` field: `async@0.2.10` and
`dom-walk@0.1.2` declare MIT in their packaged `package.json.licenses`;
`log-prefix@0.1.1` and `log-timestamp@0.3.0` declare MIT in their packaged READMEs.
The inventory records those reviewed declarations rather than treating a missing
metadata field as either permission or a prohibition.

## Upstream downloader and adapted source

[@thedave42/f1tv-dl](https://github.com/thedave42/f1tv-dl), upstream project `thedave42/f1tv-dl`,
declares ISC in the pinned package's `package.json`. Its npm archive does not
provide a standalone copyright/license file. The declared terms and provenance
are recorded in [LICENSES/f1tv-dl-ISC.txt](LICENSES/f1tv-dl-ISC.txt); no missing
copyright year has been invented.

This attribution also covers upstream-derived material in the authentication
replacement, patch excerpts and `tests/fixtures/f1tv-token.*.json` and
`tests/fixtures/download-policy-*.json`. Original local modifications are MIT;
the underlying upstream material retains its ISC terms. The install-time patches
change authentication compatibility and native stream selection; they do not
remove upstream licensing obligations. Before public redistribution, recheck
upstream notice completeness against the exact source being distributed.

## MPL components

The Ghostery/Cliqz ad-blocking dependencies and several `@remusao` packages are
MPL-2.0. They remain MPL-2.0 and are not relicensed to MIT. They are used as
unmodified third-party modules. Exact versions, upstream source commits and
source locations are recorded in [LICENSES/mpl-sources.json](LICENSES/mpl-sources.json)
and copied into the built notices. If these packages change, update that record.
Make the corresponding MPL source available to recipients when distributing the
software, and retain the MPL notices. Local changes to MPL-covered files must
remain under the MPL.

Mozilla's [MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) explains its
file-level scope and larger works. It permits original, separate application
files to use another license; it does not permit stripping MPL from dependencies.

## Fonts, icons and build data

Barlow and Barlow Condensed are copyright The Barlow Project Authors, under the
SIL Open Font License 1.1. Their complete packaged license notices are copied
into the built client's `/licenses/` directory. The fonts retain OFL-1.1 and are
not MIT. Lucide's complete ISC notice, including the inherited Feather MIT
notice, is included there too. React and React DOM notices are included with
the client. Build-time `caniuse-lite` data is CC-BY-4.0 and keeps its attribution
and terms; it is not part of the original application grant.

## Container and external programs

Node.js, Debian packages, Chromium, FFmpeg, FFprobe, tini and their dependencies
retain their own licenses. Chromium contains multiple third-party licenses;
FFmpeg's effective license depends on its build options and linked libraries.
The Debian FFmpeg build can include GPL components. Never label the complete
container, Chromium or FFmpeg as MIT.

The application invokes these as separate programs/protocols; it does not link
its own source into libavcodec or libavformat. The GNU [GPL FAQ on aggregation
and separate programs](https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation)
and [FFmpeg licensing information](https://ffmpeg.org/legal.html) explain why
their presence does not by itself require relicensing the original web app.
Their redistribution obligations still apply to the respective components.

The image retains Debian copyright notices under `/usr/share/doc/`, npm package
notices under `/app/node_modules/`, and the original project notices under
`/app/LICENSE`, `/app/THIRD_PARTY_NOTICES.md` and `/app/LICENSES/`.
Before publishing a prebuilt image, record its exact installed binary/source
package versions and provide the corresponding source, notices and any required
source offer through a compliant distribution route. Merely linking to a generic
upstream repository or retaining `/usr/share/doc/` is not a complete substitute
for those source obligations. A private build is not a public image release.

## Imagery, trademarks and saved replays

The project's MIT grant excludes `src/client/assets/race.jpg`, photographic
content embedded in `DOCS/design/*.html`, provider thumbnails, Formula 1 marks,
Netflix marks and broadcast/media content. It grants no rights to those items.
Establish permission or replace/exclude bundled photography before making the
repository public, including its reachable history. Runtime catalog imagery and
downloaded replays remain subject to their owners' rights and applicable terms.
Offline-viewing intent and a paid account do not, by themselves, grant permission
to copy or redistribute content.
