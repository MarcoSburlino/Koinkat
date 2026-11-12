# Koinkat Demo with Enable Banking sandbox

Status: implementation in progress, 2026-11-11. The separate Demo RPM is built,
inspected and tested with temporary fictional profiles. The callback is
deployed. System installation needs Marco's local sudo password; provider
application setup and the live import pilot are still pending.

## Current handoff

- App branch: `feat/demo-sandbox`. Separate identity, binary, icons, namespace,
  scheme, Demo guide and sandbox-only HTTP checks are implemented.
- Callback commit `f5ad698` is published on `main` and GitHub Pages reports
  `built`. Its new routing code is present on the public page. Deployment
  used `/home/sbu/Projects/.worktrees/koinkat-callback-demo`, branch
  `feat/demo-callback-publish`, based directly on the public branch so the
  original checkout's local guidance commit was not inadvertently published.
- Passed: app/test type checking, 370 tests across 37 files, both frontend
  builds including mock-leak checks, and 9 callback script tests.
- Native checks passed: locked Rust compile, six native transaction/IPC tests,
  optimized RPM build and no package-file collisions with installed Koinkat.
  Actual release-app tests passed via WebKitWebDriver on X11 and Wayland,
  covering fictional user/workspace creation, persistence, the hidden
  production workspace option and a manual account write. The final Demo
  title and yellow branding were checked, including light/dark screenshots.
  Temporary test databases passed integrity/schema checks; personal data and
  the default installed Demo profile were not used.
- Built RPM: `src-tauri/target/release/bundle/rpm/Koinkat Demo-0.1.7-1.x86_64.rpm`.
- Next required user action: install that RPM using [demo.md](../demo.md).
  The system package installation attempt returned `sudo: a password is
  required`. After installation, verify launcher/handler paths against
  `/usr/bin/koinkat-demo` and continue the authenticated sandbox pilot.
- Small candidate provider file: `examples/sandbox/pilot.json`, one fictional
  DKK account with four booked rows and a coherent 9,060.00 closing balance.
  Authenticated editor acceptance is still unverified. Full generation waits
  for that pilot. No personal database, finance tool or private key was read.

## Outcome

Marco wants to record a public installation and bank-setup tutorial, then
demonstrate Koinkat with invented finances. Provide a second desktop app on
his Fedora laptop, called **Koinkat Demo**, with a yellow icon and wordmark.
Use the normal Koinkat screens and bank-import logic against an Enable
Banking sandbox application and its configurable **Mock ASPSP** bank.

Maintain one codebase. Adapt the existing demo build rather than fork the
app. Keep the development fixtures available for offline development.

## Baseline before implementation

| Area | Current behavior | Implication |
| --- | --- | --- |
| Desktop identity | `src-tauri/tauri.conf.demo.json` sets `Koinkat Demo` and `com.koinkat.app.demo`. | Reuse this identity and its separate app directories. |
| Bank transport | `vite.config.ts` forces demo mode to offline fixtures. `BankLink.tsx` bypasses browser authorization in mock mode. | The existing demo cannot prove that real credentials or browser authorization work. |
| Development override | `KOINKAT_EB_REAL=1` affects development only. Development uses `com.koinkat.app`. | Do not use the ordinary dev command for recording: it can open the personal database. |
| Workspace mode | Sandbox creation is available in demo/development. `environment` and `is_demo_mode` are local metadata. | The workspace label does not constrain credentials to the provider's sandbox. |
| Credential verification | `verifyCredentials()` calls `/application` but discards its response. | Check the returned `environment` before allowing bank operations in Demo. |
| Credential store | `secrets.rs` uses service `koinkat`; entry names contain workspace UUIDs. | Separate app IDs do not separate this namespace. Fresh UUIDs reduce collision risk, but Demo needs its own service. |
| Browser callback | Both builds inherit `koinkat://`; startup registers it. The shared callback page targets that scheme. | Installing or opening Demo can compete with the personal app for callbacks. |
| Packaging | Demo inherits the main binary name, icon and window title. | Verify Linux executable/package paths, add a distinct binary and launcher, and visibly label the window. |
| Existing mock history | Most fixture history is January-March 2026 and the client applies date filters. | It is outside the current default import window. Generate recent data instead. |

Local package metadata reports Koinkat 0.1.7 installed at `/usr/bin/koinkat`.
The checkout is at `1f31695`. No personal database or financial MCP tool was
accessed for this plan. Some older agent documentation disagrees with the
code about balance preference, relink identity and FX precision; use the code.

## Provider facts and limits

Enable Banking registers separate sandbox applications with their own ID
and key. Sandbox applications activate automatically. The environment
belongs to that registered application; both environments use the same API
host. `/application` returns an `environment` field.

Mock ASPSP supports custom data managed in the Control Panel and simulated
authorization without bank credentials. Its transactions paginate in
batches of ten. Prefer it for controlled recordings; individual banks'
sandboxes can be unstable and offer less control over their data.

The provider publishes a synthetic JSON example. Its account envelope uses
`accounts`, with account `info`, transactions and balances. Validate the
actual Control Panel import/editor contract in a small pilot before writing
the full dataset generator; Koinkat's fixture file is not automatically a
provider import file.

Sources checked 2026-11-11:

- [Sandbox and Mock ASPSP](https://enablebanking.com/docs/api/sandbox/)
- [Control Panel registration](https://enablebanking.com/docs/api/control-panel/)
- [Application metadata and API](https://enablebanking.com/docs/api/reference/)
- [Published synthetic data example](https://enablebanking.com/sample-data/DK-Danske_Bank-synthetic-1.json)
- [Production account whitelisting](https://enablebanking.com/docs/api/linked-accounts/)
- [Tauri identity, product name and binary configuration](https://v2.tauri.app/reference/config/)

## Proposed app separation

| Property | Personal app | Koinkat Demo |
| --- | --- | --- |
| Identifier | `com.koinkat.app` | `com.koinkat.app.demo` |
| Binary | `koinkat` | `koinkat-demo` |
| Linux database, default XDG config location | `~/.config/com.koinkat.app/koinkat.db` | `~/.config/com.koinkat.app.demo/koinkat.db` |
| Backups and WebView storage | Personal app directories | Demo app directories |
| Credential-store service | Existing `koinkat` | Separate `koinkat-demo` |
| URL scheme | `koinkat://` | `koinkat-demo://` |
| Provider credentials | User's production application | New sandbox application only |
| Branding | Existing assets | Yellow variant, `Demo` label, `Koinkat Demo` window title |

Resolve actual directories through Tauri; respect XDG overrides. Inspect the
built RPM's file list before installation to prove that it will not replace
`/usr/bin/koinkat` or its launcher/icons. `mainBinaryName` is available in
the installed Tauri configuration schema. Check GNOME window grouping and
single-instance behavior too; a separate menu name is not sufficient proof.

An existing Demo database, if present, must be treated as existing data.
Do not silently overwrite it or migrate its old keychain entries by reading
from the production namespace. Re-enter sandbox credentials if needed.

### Build and credential behavior

Repurpose Vite `demo` mode to use the real HTTP client with mocks disabled.
Keep `/rules` hidden and Sandbox creation visible. Add a build flag such as
`__KOINKAT_DEMO_APP__` for branding and provider restrictions. Keep production
behavior and development's fixture support intact. Extend the mock-leak
scanner to the new demo bundle so an offline fixture cannot silently replace
the connection shown in the tutorial.

Demo must require the provider's `/application` response to report
`SANDBOX`. Fail closed on `PRODUCTION`, missing/unrecognized metadata, or
failed verification. Changing a local dropdown is not sufficient protection.
Reject production-mode workspace/credential saves in Demo, and enforce the
provider check in the bank service for every path: initial linking, Settings
replacement, automatic sync, restored sessions and reconnection. Cache a
successful check only for the current workspace and credential identity;
invalidate it when either changes. Permit the metadata request needed to
perform the check without recursively requiring the check itself.

Use synthetic responses in automated rejection tests, never the user's
production key. Keep all bank API access through the existing dispatcher.
Derive the Rust secret namespace from trusted app identity, preserving the
existing personal app namespace. No database migration should be needed.

### Callback routing

Preserve the production callback URL and its default behavior. The callback
repository currently keeps its entire site in `index.html`. First prototype
a fixed demo selector on that same page, for example a registered redirect
URL ending in `?app=demo`. Only that exact selector maps to the fixed
`koinkat-demo://auth-callback` target. Never accept an arbitrary target URL
or scheme from query input. Preserve `code` and `state`, and keep manual
copy available.

Validate that Enable Banking preserves the registered selector while adding
the authorization parameters. This is an untested integration detail. If it
does not, use a dedicated static demo callback path and update the callback
repo's one-file convention as part of that feature. Either solution must
avoid launching or registering the personal app's scheme from Demo.

The Demo listener should validate its own exact scheme/host and OAuth state.
The automatic flow must be rehearsed after the callback change is deployed.
Do not assume that merely closing the personal app solves scheme ownership.

## Synthetic dataset

Create a small, hand-authored fictional story for **Alex Morgan**. Suggested
accounts, labels and target closing balances:

| Account | Currency | Closing balance |
| --- | --- | --- |
| Everyday Denmark | DKK | 18,450.00 |
| Euro spending | EUR | 2,500.00 |
| Euro savings | EUR | 8,000.00 |

These are proposed invented values, not copies or transformations of real
financial records. Use test identifiers and fictional counterparties. Three
accounts and two currencies are enough for the initial tutorial; GBP can be
added later if the recording needs another currency.

Generate roughly 100-150 transactions over the two previous calendar months
and the current month through the recording day. Include:

- Salary, rent, groceries, cafes, transport and one subscription repeated
  across months, with a few unknown merchants to leave work in Review.
- A DKK 900 dinner and two DKK 300 repayments, yielding DKK 300 personal
  spending after linking them through the existing split wizard.
- A EUR 500 transfer between the two euro accounts, with matching test
  counterpart account identifiers, so it can be confirmed as a transfer.
- An optional recent pending purchase for the pending badge. Demonstrating
  settlement/cancellation needs a second provider dataset and a separate
  tested sync step; do not promise the local fixture lifecycle automatically.

Keep amounts as decimal strings. Assign stable account identities and unique
transaction references, and compute coherent opening/closing balances.
Koinkat currently prefers `XPCD`, then `ITAV`, then `CLBD`; make any provided
available and booked balances consistent with pending activity. Keep paired
entries and reimbursement dates compatible with their intended workflows.

Store a reusable synthetic source plus a generator with an explicit
`--as-of YYYY-MM-DD`. Freeze that date and generated output for all takes.
Future recordings regenerate fresh dates rather than change the laptop clock.
Use a dataset comfortably inside the initial import window, with no future
transactions. More than ten rows exercises provider pagination.

Upload only the generated synthetic data to Mock ASPSP. Do not use the
provider's real-account export shortcut, a personal DB copy, or the MCP's
separate test database as the app's starter database. Their data formats and
purposes differ.

Budgets, categories learned from confirmations and split/transfer links are
Koinkat state, not bank-import metadata. Create those with normal app flows.
Keep two recording states: **fresh onboarding**, and **populated showcase**
with categories, a monthly DKK budget and a fictional trip event configured.
Use a new Demo workspace for repeat onboarding; leave the populated one
available for the product tour. Any whole-profile reset must be explicitly
limited to Demo, preserve its prior state, include its WebView state, and
must not reuse the workspace-only sandbox-deactivation helper as a full reset.
Snapshots stay local and private: they may include session identifiers or a
private key if the OS credential-store fallback was used.

## Roadmap and ownership

Codex owns implementation, data generation, builds, technical verification,
documentation and preparation of the recording materials. Marco owns account
sign-in, private-key selection in the app, browser consent, presentation and
publication. For authenticated Control Panel work, Codex supplies the exact
steps and import files; Marco operates the website. No private key needs to
be pasted into chat or read by an agent.

Defaults for implementation: one codebase, yellow Koinkat Demo on Fedora,
Mock ASPSP, Alex Morgan, three DKK/EUR accounts, and one first tutorial covering
installation, credential setup, bank connection and a short product tour.
Names, amounts and video style are adjustable without holding up engineering.
The main priority is a complete working import before elaborate video work.

### Progress and dependencies

| Phase | Deliverable | Owner | Depends on | Status |
| --- | --- | --- | --- | --- |
| 0 | Source research and agreed task roadmap | Codex | None | Complete |
| 1 | Separate yellow Demo app and inspected package | Codex; Marco for OS prompts and visual check | 0 | Built/tested; system installation requires sudo authentication |
| 2 | Sandbox-only bank client and callback change ready to deploy | Codex | 1 | Complete; native tests and callback regression checks passed |
| 3 | Reachable Demo callback and sandbox application configured | Codex + Marco | 2 | Callback deployed; sandbox application setup pending |
| 4 | One fictional account imported through the full browser flow | Codex + Marco | 3 | Pending |
| 5 | Full reusable fictional bank dataset | Codex; Marco uploads in Control Panel | 4 | Pending |
| 6 | Populated showcase and repeatable fresh onboarding | Codex + Marco | 5 | Pending |
| 7 | Rehearsed script, shot list and recording setup | Codex + Marco | 6 | Pending |
| 8 | Recorded, reviewed and published tutorial | Marco; Codex assists with review and publication text | 7 | Pending |

Phase 1 and local work in phase 2 can proceed without an Enable Banking login.
Callback deployment and sandbox account preparation are the first external
dependencies. Full dataset generation waits for the small provider pilot.
Script drafting can overlap engineering; final shots and narration must
reflect the tested screens. No phase is marked complete solely because its
code compiles.

### Phase 0: research and roadmap

- [x] Codex: read Koinkat brain context, canonical app documentation and the
  relevant source, and inspect the callback implementation.
- [x] Codex: verify the provider's public sandbox documentation and document
  the gaps between the existing offline demo and the required recording app.
- [x] Codex: write this roadmap and record it in project memory.

**Complete when:** the intended app separation, owner of each step and
remaining provider/runtime uncertainties are written down. This phase does
not imply the app or sandbox is already configured.

### Phase 1: create the separate yellow Demo app

**Codex does:**

- [x] Preserve current work and implement the Demo changes in an isolated
  branch or checkout, using the existing repo rather than a new project.
- [x] Set the distinct binary, window title, launcher and yellow branding.
  Preserve the existing logo shape; check visibility on light and dark themes.
- [ ] Separate its app directories, credential-store namespace and URL
  scheme, including startup registration and single-instance behavior.
- [x] Add an explicit Demo development command. Audit the merged Tauri
  configuration, including arrays; never launch the ordinary development
  configuration against the personal app directories.
- [x] Build an initial RPM and inspect its executable, desktop-file, icon
  and resource paths for collisions before installation.
- [ ] Prepare/run the Fedora package installation when this implementation
  phase is underway, requesting the required OS authorization at that point.
- [x] Update the build and architecture docs with the implemented behavior.

**Marco does:**

- [ ] Respond to any required installation/desktop permission prompt.
- [ ] Open the yellow Demo launcher and confirm its name and appearance.
  Complete any visual desktop checks that Codex cannot drive with available
  tools, using Codex's short checklist.

**Complete when:** Demo opens to its own onboarding, has a distinct launcher
and window identity, and all resolved data/package paths belong to Demo.
Verify persistence with synthetic state and independent instance behavior.
No personal database query is required.

### Phase 2: enable real sandbox HTTP and correct callback routing

**Codex does:**

- [x] Repurpose the demo build to call the real Enable Banking client;
  preserve offline fixtures for development.
- [x] Require provider metadata to report `SANDBOX` before any bank-data or
  authorization operation. Cover Settings changes, restores, background sync
  and reconnects, not only first-run onboarding.
- [x] Invalidate cached verification when credentials or workspace change.
  Test production, missing and malformed metadata using synthetic responses.
- [x] Extend the mock-leak check to the Demo bundle and keep debug routes
  hidden. Show a persistent, unobtrusive Demo label.
- [x] Prepare the callback page's fixed demo routing and exact scheme/state
  validation. Preserve production callback behavior and manual copy support.
- [x] Run type checking, relevant service tests, both frontend builds, Rust
  checks/tests for native changes, and callback regression checks.
- [x] Produce a reviewable callback diff, expected URL, deployment steps and
  rollback instructions before requesting any publication authorization.

**Marco does:** nothing during local implementation. Any callback publishing
authorization happens only after the concrete change is ready; it affects
the existing publicly hosted callback page.

**Complete when:** automated checks pass, Demo cannot call bank endpoints
with production credentials, and the callback change is ready for deployment.
Actual provider/browser behavior is still to be proven in phase 4.

### Phase 3: prepare the hosted callback and Enable Banking application

**Codex does:**

- [ ] Deploy the prepared callback change once publication is authorized,
  or give Marco the exact publishing steps if account access is unavailable.
- [ ] Check the public page's Demo target and unchanged default behavior.
- [ ] Give Marco the exact redirect URL, suggested application name and
  short Control Panel checklist. Do not ask him to invent technical values.
- [ ] Prepare a minimal synthetic provider file with one account and a few
  transactions, adapting it to the authenticated editor contract as needed.

**Marco does:**

- [ ] Open a clean browser profile, sign into Enable Banking and complete
  any email-link/MFA steps privately.
- [ ] Register a new **Sandbox** application, using browser key generation
  and the exact Demo redirect URL supplied by Codex.
- [ ] Keep the downloaded PEM locally and back it up privately. Select it
  through Koinkat Demo's file picker; never paste its contents into chat.
- [ ] Open Mock ASPSP configuration and import/paste the small synthetic
  dataset using the supplied instructions. If its interface differs, report
  the field labels or a non-secret error so Codex can adapt the file.

**Complete when:** the callback is reachable, the sandbox application and its
redirect are registered, and the pilot mock data is available for consent.
Confirm how the custom Mock ASPSP dataset is selected during authorization.
Authenticated editor format and callback query-selector preservation remain
explicit checks, not assumptions.

### Phase 4: prove the full connection flow with a tiny dataset

**Codex does:**

- [ ] Supply a short walkthrough with expected outcomes at each screen.
- [ ] Verify credential validation, request handling, import mapping and
  stored Demo state; diagnose and fix failures before increasing data volume.
- [ ] Check the resulting account, currency, balance and transactions against
  the synthetic input. Check a second sync and reconnection for duplicates.
- [ ] If redirect query selection is not preserved, implement/test the
  dedicated callback path alternative, deploy it with authorization and
  provide the replacement URL for Marco to register.

**Marco does:**

- [ ] Create the Demo sandbox workspace and enter its application ID.
- [ ] Choose the sandbox PEM locally, then click through Mock ASPSP consent
  and the browser's Open Koinkat Demo prompt.
- [ ] Exercise the manual Copy Code fallback in a separate fresh attempt.
- [ ] Confirm the expected account/transactions are visible and report any
  errors without exposing a private key or an authentication link.

**Complete when:** verified credentials, browser consent, automatic callback,
manual fallback, import, repeat sync and relink all work with fictional data.
The callback reaches Demo and does not open the personal app. Only then
proceed to the full dataset.

### Phase 5: create the full fictional financial history

**Codex does:**

- [ ] Write the deterministic generator and synthetic source described in
  the dataset section. Supply an explicit recording date and recent history.
- [ ] Produce the provider-ready import file, data summary and expected
  values for the three accounts, balances, transfers and repayments.
- [ ] Validate decimal math, dates, unique references, stable account
  identities, coherent balances and more than one page of transactions.
- [ ] Verify the full imported result, including pagination, date ranges,
  repeat sync and the relevant multi-currency displays. Rebuild if fixes
  change the app, rerunning the affected checks.

**Marco does:**

- [ ] Upload/paste the generated file into Mock ASPSP through the signed-in
  Control Panel, following the supplied replacement/import instructions.
- [ ] Connect it from a fresh Demo workspace and complete browser consent.
- [ ] Give a quick visual check that the fictional story is suitable for
  filming; names and amounts can be adjusted here without technical design.

**Complete when:** the expected recent history is visible, charts are useful,
the second sync adds no duplicate rows, and the split/transfer examples can
be demonstrated. Do not change provider account identities under an existing
linked workspace without treating it as a new dataset/workspace.

### Phase 6: prepare showcase state and repeatable onboarding

**Codex does:**

- [ ] Prepare the steps to categorize transactions, link the dinner
  repayments, confirm the internal transfer, mark a subscription recurring,
  and create a monthly budget plus a trip event through normal app flows.
- [ ] Perform supported app actions with available tools; supply the exact
  short click sequence for interactive actions Marco needs to perform.
- [ ] Keep a populated **Showcase** workspace and prepare a separate
  **Recording** workspace with a fictional local user and no personal labels.
- [ ] Document a repeat-onboarding procedure and verify it once. A new
  workspace repeats workspace setup; repeating the very first user screen
  requires a separately preserved/reset Demo profile and WebView state.
- [ ] Prepare a way to return to the showcase between takes. Keep snapshots
  private; they can contain session information or fallback-stored keys.
- [ ] Rebuild/inspect/install the final Demo package if it has changed since
  phase 1, then confirm persistence and callbacks on the installed build.

**Marco does:**

- [ ] Complete any remaining interactive showcase setup from the click list.
- [ ] Walk through the populated app once and point out anything awkward
  to explain or visually confusing.
- [ ] Confirm the final installed yellow Demo opens reliably from GNOME.

**Complete when:** both the setup recording and populated tour can be repeated
without rebuilding the app or manually editing a database. Generated bank
history and Koinkat's learned/organized state are both accounted for.

### Phase 7: prepare the tutorial and rehearse it

**Codex does:**

- [ ] Write the script, narration draft, chapter order and shot list against
  the tested app and provider screens, using the recording outline below.
- [ ] Explain the production-only registration/whitelisting steps accurately
  without showing Marco's existing production accounts.
- [ ] Label the local Demo installer and Demo redirect clearly; list the
  normal release/download and callback instructions viewers should follow.
- [ ] Supply a preflight checklist, required close-ups, error recovery notes,
  and the exact state to restore before each take.
- [ ] Review a short test recording if Marco supplies it; identify unreadable
  text, pacing problems, accidental disclosures and missing explanations.

**Marco does:**

- [ ] Choose the language, voice style, intended platform and approximate
  length before the final script is locked. These choices do not block
  engineering. Default content is one setup tutorial with a short app tour.
- [ ] Set up the clean recording desktop/browser, hide notifications and
  make a short test capture with readable UI and usable audio.
- [ ] Rehearse once and flag any explanation that does not sound natural.

**Complete when:** every planned shot is repeatable, the text is readable,
all visible finances are fictional, and the production/sandbox differences
are clear to a first-time viewer.

### Phase 8: record, review and publish

**Marco does:**

- [ ] Record the installation/setup sequence and product tour. To show
  creating a fresh API application, create a separate disposable Sandbox
  application during filming and select its newly downloaded PEM locally.
  Otherwise reuse rehearsal credentials and describe their creation.
- [ ] Supply the recording or rough cut for review if editing help is wanted.
- [ ] Assemble the final cut using the chosen recording/editing workflow,
  choose the final title/thumbnail, and publish from his own account.
- [ ] After filming is complete, retire the disposable recording application
  if one was used, keeping the private rehearsal application for future demos.

**Codex does:**

- [ ] Prepare edit notes, chapter timestamps, captions/subtitle draft, title
  options, description text and the correct viewer links. Timestamps and
  captions must follow the actual cut, not invented timing.
- [ ] Review the supplied final cut for technical accuracy and any exposed
  keys, email links, account details, notifications or unrelated windows.
- [ ] Provide final publishing text and, if requested, prepare a concrete
  website/README link update for review after the video has a public URL.
- [ ] Write a short maintenance checklist: regenerate dates before future
  recordings, check consent/credentials, and refresh Demo from source when
  product behavior changes.

**Complete when:** Marco has published the reviewed video, its description
points viewers to the normal installation/setup path, and the yellow Demo
app remains usable for future demonstrations. Publishing a downloadable
Demo installer, cross-platform tutorial footage and a separate long product
tour are optional follow-ups, not prerequisites for this first video.

### Verification responsibilities

Codex owns `npm run typecheck`, relevant service integration tests, production
and demo frontend builds, and mock-leak checks. Native changes also require
`cargo check` and `cargo test` under the project rules. New tests should prove
observable behavior: production/malformed metadata blocks bank operations,
credential changes invalidate verification, and callbacks select the correct
app and enforce state. Packaging checks inspect the actual generated files.

Marco supplies the authenticated browser interactions and confirms desktop
behavior Codex cannot directly exercise. Codex owns diagnosing failures and
making fixes; Marco should not have to debug source code or invent API data.
Provider-dependent checks are recorded separately from automated test passes.

The next action is installing the inspected RPM with local sudo authentication.
Native build/testing and callback deployment are complete. After installation,
the authenticated Enable Banking setup is the next user-dependent phase.

## Recording outline

1. Open with: "This recording uses Enable Banking's sandbox and fictional
   finances." Show the yellow Demo app so the distinction is visible.
2. Explain how to find the normal Koinkat release and the Fedora installer.
   Demonstrate installation using the separate Demo package. Label that local
   package clearly; it is not an asset viewers can currently download.
3. Show Enable Banking sign-in, Sandbox selection, application naming,
   browser key generation/download, application ID and exact redirect URL.
   Explain that the credentials are an application ID plus a private key,
   rather than a single API-key string. Show choosing the PEM, never its text.
4. Create the Demo workspace, verify credentials, choose Mock ASPSP, complete
   simulated authorization and import the recent fictional history.
5. Tour Dashboard, Review, a split repayment, transfer confirmation, Analysis
   and a budget. This can be a separate product video if setup is already long.
6. Explicitly explain the production differences: choose Production, fill its
   additional registration fields, activate by whitelisting your own accounts,
   then authorize the bank again from Koinkat. Sandbox auto-activation does
   not demonstrate that extra step. Normal Koinkat uses the normal callback
   URL and **Connect a bank**; the recording's Demo selector/branding are
   specific to the filming setup.

Use a clean browser profile so existing production application names, real
linked accounts, inbox messages, autofill and downloads do not enter the
recording. A sandbox key is still a credential: keep it out of source,
screenshots and shared exports. A dedicated recording application can be
retired after filming while a separate private sandbox application keeps the
Demo app useful. Do not delete an application until the recording is finished.

## Remaining external and runtime checks

System installation requires Marco's local sudo authentication. Provider
sign-in/consent is then needed to verify the Mock ASPSP editor/import contract,
redirect-selector preservation and the full browser flow. Native build,
package inspection and temporary-profile UI checks are complete. No personal
application configuration or financial database has been opened or changed.
