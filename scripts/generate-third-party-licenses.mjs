/**
 * Generates THIRD-PARTY-LICENSES.md from the two lockfiles.
 *
 *   node scripts/generate-third-party-licenses.mjs           # write the file
 *   node scripts/generate-third-party-licenses.mjs --check   # fail if stale
 *
 * Why this exists: Koinkat distributes compiled installers, and MIT,
 * BSD-2/3-Clause, Apache-2.0, OFL-1.1 and CDLA-Permissive-2.0 all condition
 * redistribution on retaining copyright and licence notices. Being in the
 * repository is not what discharges that - the notice has to travel with the
 * binary - so this file is also bundled as a Tauri resource.
 *
 * Two sources, because there are two dependency trees:
 *   - Rust: cargo-about, configured in src-tauri/about.toml. It reads the
 *     crates.io index rather than the local cargo cache, so one run covers
 *     Windows, macOS and Linux. A local-cache scan only ever sees the host
 *     platform's crates and silently under-reports.
 *   - npm: license-checker-rseidelsohn, restricted to production dependencies
 *     so the ~110 build-only packages are not listed as if they shipped.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = resolve(repoRoot, 'src-tauri');
const outputPath = resolve(repoRoot, 'THIRD-PARTY-LICENSES.md');
const checkOnly = process.argv.includes('--check');

const isWindows = process.platform === 'win32';

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // npx/npm are .cmd shims on Windows and are not directly executable.
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

// ── Rust ────────────────────────────────────────────────────────────────

function rustSection() {
  return run('cargo', ['about', 'generate', 'about.hbs'], tauriDir).trim();
}

// ── npm ─────────────────────────────────────────────────────────────────

/**
 * Group packages by licence identifier, then by the exact licence text, so a
 * single copy of the MIT text serves the ~50 MIT packages. Distinct copyright
 * lines mean distinct texts, so those are listed separately - which is the
 * point, since the copyright line is the part the licences require retained.
 */
function npmSection() {
  const raw = run(
    'npx',
    ['license-checker-rseidelsohn', '--production', '--json'],
    repoRoot,
  );
  const packages = JSON.parse(raw);

  // license-checker includes the root project. Koinkat is the work being
  // licensed, not a dependency of it - and because package.json is private it
  // is reported as UNLICENSED, which would be actively misleading here.
  const rootName = JSON.parse(
    readFileSync(resolve(repoRoot, 'package.json'), 'utf8'),
  ).name;
  for (const key of Object.keys(packages)) {
    if (key.startsWith(`${rootName}@`)) delete packages[key];
  }

  const byLicence = new Map();
  for (const [nameVersion, meta] of Object.entries(packages)) {
    const licence = meta.licenses ?? 'UNKNOWN';
    let text = '';
    if (meta.licenseFile && existsSync(meta.licenseFile)) {
      text = readFileSync(meta.licenseFile, 'utf8').replace(/\r\n/g, '\n').trim();
    }
    if (!byLicence.has(licence)) byLicence.set(licence, new Map());
    const byText = byLicence.get(licence);
    if (!byText.has(text)) byText.set(text, []);
    byText.get(text).push({ nameVersion, ...meta });
  }

  const total = Object.keys(packages).length;
  const overview = [...byLicence.entries()]
    .map(([licence, byText]) => {
      const count = [...byText.values()].reduce((n, list) => n + list.length, 0);
      return { licence, count };
    })
    .sort((a, b) => b.count - a.count || a.licence.localeCompare(b.licence));

  const lines = [];
  for (const { licence, count } of overview) {
    lines.push(`- ${licence} (${count})`);
  }
  lines.push('');

  for (const { licence } of overview) {
    lines.push(`### ${licence}`, '');
    const byText = byLicence.get(licence);
    const groups = [...byText.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    );
    for (const [text, list] of groups) {
      lines.push('Applies to:', '');
      for (const pkg of list.sort((a, b) =>
        a.nameVersion.localeCompare(b.nameVersion),
      )) {
        const where = pkg.repository ? ` - ${pkg.repository}` : '';
        const who = pkg.publisher ? ` (${pkg.publisher})` : '';
        lines.push(`- \`${pkg.nameVersion}\`${who}${where}`);
      }
      lines.push('');
      if (text) {
        lines.push(
          '<details>',
          '<summary>Licence text</summary>',
          '',
          '```text',
          text,
          '```',
          '',
          '</details>',
          '',
        );
      } else {
        lines.push(
          `> No licence file shipped in the package. The declared identifier is \`${licence}\`.`,
          '',
        );
      }
    }
  }

  return { markdown: lines.join('\n').trim(), total };
}

// ── Typefaces ───────────────────────────────────────────────────────────

const FONT_PACKAGES = [
  ['DM Sans', '@fontsource/dm-sans'],
  ['DM Serif Display', '@fontsource/dm-serif-display'],
  ['JetBrains Mono', '@fontsource/jetbrains-mono'],
];

/**
 * Build the typeface table from each package's own LICENSE file rather than
 * from hardcoded strings. In an OFL licence file the copyright notice is
 * everything before the first blank line; @fontsource repeats it once per
 * font file, so only the first sentence-run is kept for readability.
 *
 * These lines are the specific thing OFL clause 2 requires be retained, so
 * transcribing them by hand is exactly the wrong approach - a typo here is a
 * false attribution.
 */
function fontTable() {
  const rows = [];
  let anyReservedName = false;

  for (const [display, pkg] of FONT_PACKAGES) {
    const licensePath = resolve(repoRoot, 'node_modules', pkg, 'LICENSE');
    if (!existsSync(licensePath)) {
      throw new Error(
        `Cannot build the typeface notice: ${pkg}/LICENSE is missing. ` +
          'Run `npm install` before generating.',
      );
    }
    const header = readFileSync(licensePath, 'utf8')
      .replace(/\r\n/g, '\n')
      .split('\n\n')[0]
      .trim();

    // @fontsource repeats "<file>.ttf: Copyright ..." after the first notice.
    const notice = header.split(/\s+[\w[\],-]+\.ttf:/)[0].trim();
    if (/reserved font name/i.test(notice)) anyReservedName = true;

    rows.push(`| ${display} | ${notice} | \`${pkg}\` |`);
  }

  return { rows, anyReservedName };
}

// ── Assembly ────────────────────────────────────────────────────────────

function buildDocument() {
  const npm = npmSection();
  const rust = rustSection();
  const fonts = fontTable();

  const reservedNameNote = fonts.anyReservedName
    ? 'Where a notice above reserves a font name, that name is not used here: ' +
      'the typefaces are distributed under their existing names, so clause 3 ' +
      'of the OFL is not engaged.'
    : 'None of the notices above reserves a font name.';

  return `# Third-party licences

Koinkat is distributed under GPL-3.0-or-later (see [LICENSE](LICENSE)). It
bundles third-party code and typefaces that carry their own licences, and
several of those licences require their copyright and permission notices to
travel with the distributed binary. This file is that notice. It ships inside
the installer as well as living here.

**Do not edit this file by hand.** It is generated from \`package-lock.json\`
and \`src-tauri/Cargo.lock\`:

\`\`\`bash
npm run licenses
\`\`\`

CI regenerates it and fails if the result differs from what is committed, so
it cannot drift from the lockfiles.

Scope: the npm list covers production dependencies only, since build-only
packages do not ship. The Rust list covers every target the release workflow
builds for - Windows, macOS (Intel and Apple Silicon) and Linux - because
\`Cargo.lock\` is the union of all platforms and a single machine only ever
fetches its own.

## Typefaces

Three typefaces are compiled into the application binary as \`.woff2\` files.
They are distributed under the SIL Open Font License 1.1, whose full text is
reproduced in the OFL-1.1 entry below.

| Typeface | Copyright notice | Package |
|---|---|---|
${fonts.rows.join('\n')}

The files bundled here are the \`@fontsource\` builds, subset by character
range for web delivery. The outlines are otherwise unmodified.
${reservedNameNote}

## Certificate authority data

\`webpki-roots\` bundles the Mozilla CA root store as data rather than code,
under the Community Data License Agreement - Permissive - Version 2.0. That
agreement's one obligation on redistribution is that its text accompany the
data; the full text is in the CDLA entry below.

## npm dependencies (${npm.total} packages)

${npm.markdown}

## Rust dependencies

${rust}
`;
}

// Normalise to LF. Licence texts reach us from two subprocesses and from files
// on disk, so on Windows the assembled document is a mix of LF and CRLF; the
// --check path reads the file back normalised, and without this the comparison
// would report drift on every Windows run.
const document = buildDocument().replace(/\r\n/g, '\n');

if (checkOnly) {
  const current = existsSync(outputPath)
    ? readFileSync(outputPath, 'utf8').replace(/\r\n/g, '\n')
    : '';
  if (current.trim() !== document.trim()) {
    console.error(
      'THIRD-PARTY-LICENSES.md is out of date with the lockfiles.\n' +
        'Regenerate it with `npm run licenses` and commit the result.\n',
    );
    // Print what actually differs. Without this a CI failure says only "it
    // drifted", which is useless when the drift is environmental rather than
    // a real dependency change.
    const a = current.trim().split('\n');
    const b = document.trim().split('\n');
    const onlyCommitted = new Set(a);
    const onlyGenerated = new Set(b);
    for (const line of b) onlyCommitted.delete(line);
    for (const line of a) onlyGenerated.delete(line);
    const show = (label, set) => {
      const list = [...set].filter((l) => l.trim());
      console.error(`${label} (${list.length} lines)`);
      for (const l of list.slice(0, 40)) console.error(`  ${l}`);
      if (list.length > 40) console.error(`  ... and ${list.length - 40} more`);
      console.error('');
    };
    show('Only in the committed file:', onlyCommitted);
    show('Only in the freshly generated file:', onlyGenerated);
    process.exit(1);
  }
  console.log('THIRD-PARTY-LICENSES.md is up to date.');
} else {
  writeFileSync(outputPath, document, 'utf8');
  console.log(`Wrote ${outputPath}`);
}
