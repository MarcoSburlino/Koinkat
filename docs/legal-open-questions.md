# Koinkat - legal questions and how they were closed

Companion to [`legal-review-2026-08-26.md`](legal-review-2026-08-26.md).
Working notes behind the 2026-08-27 pass are in
[`legal-open-questions-answered-2026-08-27.md`](legal-open-questions-answered-2026-08-27.md).

Opened 2026-08-26 with nine unresolved questions. Worked through on
2026-08-27. This file now records the outcome of each rather than a to-do
list.

Everything below was written by a non-lawyer. Where a question was resolved
against a primary source, the source is cited. Where it was closed by a
decision instead, that is stated plainly and the decision is recorded with
its reasoning, so a later reader can tell the difference between "this was
answered" and "this was accepted".

## Status

| # | Question | Outcome |
|---|---|---|
| 1 | Callback page and GDPR controllership | **Closed by decision.** Narrowed substantially; no lawyer engaged. |
| 2 | Donations and the Cyber Resilience Act | **Resolved.** Recital 15. Donations without profit intent are fine. |
| 3 | Do EB's terms permit distributing this? | **Closed by decision**, pending a reply from Enable Banking. |
| 4 | Controller/processor in the user-EB leg | **Resolved** as far as it affects Koinkat. |
| 5 | What must ship with the binaries | **Resolved and implemented.** |
| 6 | Setup guide vs EB's documentation | **Resolved.** Low risk; disclaimer added. |
| 7 | CDLA-Permissive-2.0 vs GPL-3.0 | **Resolved.** Compatible. |
| 8 | GitHub Pages request logs | **Resolved**, and it corrected an error in the review. |
| 9 | Trademark | **Closed by decision.** No registration for now. |

Net position: one email outstanding to Enable Banking, one optional email to
GitHub Support, and no lawyer engaged. Two of the nine turned out to point
the wrong way in the original review; both corrections are recorded at the
bottom.

---

## 1. Does hosting the default callback page make the maintainer a controller?

**Closed by decision, not by legal opinion.**

The question got considerably smaller once question 8 was answered. The
original framing assumed the maintainer might hold a log of authorization
codes. He does not, and has no way to obtain one - GitHub exposes no request
logs to Pages site owners. What remains is only "you chose the default
host", not "you hold the data".

Two further points narrow it:

- **What is actually in that log line.** An opaque single-use code beside an
  IP address, and the IP is the personal data. GitHub logs that IP on every
  request to every Pages site regardless of what the page contains. Remove
  the code from the picture and the residual fact is "the host I chose logs
  visitors' IPs", which is true of every website ever made. The code adds
  sensitivity, not identifiability, and it is inert without an RS256 key the
  maintainer never had.
- **The case law cuts less than it looks.** The decisions a lawyer would
  reach for are *Fashion ID* (C-40/17) and *Wirtschaftsakademie* (C-210/16).
  Both found joint controllership where the operator obtained a benefit
  serving its own purpose - advertising value from a Like button, audience
  statistics for a fan page. Neither is present here: the project receives
  nothing, learns nothing, and the processing serves no purpose of its own
  beyond bouncing a browser back to the user's machine.

`UNVERIFIED`: those case characterisations are from general knowledge and
were not checked against the judgment texts. They are here to show a lawyer
where the argument runs, not to substitute for one.

**Decision taken.** No lawyer engaged. The residual risk is accepted as
proportionate for a non-commercial project with no revenue. Instead:

1. The logging is now disclosed in the README and in the in-app setup guide,
   including that GitHub does not expose those logs to anyone here.
2. Self-hosting the callback page is documented as an equal option rather
   than an afterthought, so the maintainer-registered default stops being
   the path everyone takes by default reasoning.
3. Enable Banking has been asked whether they accept an RFC 8252 redirect -
   a private-use URI scheme (`koinkat://auth-callback`) or a loopback
   redirect (`http://127.0.0.1:<port>/`). Either would remove the hosted
   page from the flow entirely and dissolve this question rather than
   answering it. See question 3 for the email.

**If EB says yes to either redirect scheme, revisit this and delete the
hosted hop.** That is a three-line change and it is worth more than any
opinion this question could have bought.

**Best guess, clearly marked as a guess:** not a controller. **Confidence:
moderate**, up from low-to-moderate before question 8 was answered.

---

## 2. Would accepting donations forfeit the Cyber Resilience Act carve-out?

**Resolved. The answer is no, and it is in the Regulation's own text.**

The operative language is **Recital 15**, not Recital 18 - the original
review cited the wrong recital, which is corrected below.

Recital 15 lists what can make a supply commercial: charging a price;
charging for technical support beyond cost recovery; an intention to
monetise; requiring personal-data processing as a condition of use; or
"accepting donations exceeding the costs associated with the design,
development and provision"
(<https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202402847>).

It then answers the question directly: "Accepting donations without the
intention of making a profit" should not be considered a commercial activity
(same source).

Recital 18 supplies the separate point that "the mere circumstances under
which the product ... has been developed, or how the development has been
financed" are not to be taken into account (same source). So grant or
sponsor funding of the work does not by itself make the supply commercial.

**Practical line:**

- **Safe:** a Sponsors button, Open Collective, "buy me a coffee", one-off or
  recurring donations, a thank-you list.
- **Not safe:** donor-only builds, early access, releases or security updates
  supplied only to donors, or conditioning any functionality on paying.
  These convert a donation into a price.

**Caveat, and it is a real one.** Recitals are interpretive aids, not
operative provisions, and the corresponding article text was not traced
here. The Commission's Article 26 guidance is the natural next source if
more certainty is ever wanted. Note also the dates: reporting obligations
apply from 11 September 2026 and the remainder from 11 December 2027.

**Decision taken.** The review's earlier advice - "do not add any funding
channel until this is answered" - is retired. It is answered.

---

## 3. Do Enable Banking's terms permit distributing this software?

**Closed by decision, pending a reply from Enable Banking.**

Their Terms of Service permit the *user's* side squarely: production use
"solely for evaluation purposes or for the personal use of private
individuals", limited to Linked Accounts
(<https://enablebanking.com/terms/>). The in-app guide's description of that
is accurate almost clause for clause.

What the terms do not address is whether a third party may distribute
software that instructs users to do the permitted thing. The FAQ is silent
too (<https://enablebanking.com/docs/faq/>). Silence is recorded as silence.

**Why the reading is probably right.** The non-transfer clause is a standard
licensee restriction: it constrains what *the licensee* may do with *the
licensor's* assets. Its addressee is the Control Panel user and its subject
is the Control Panel and API. A developer who never holds those assets is
not its addressee, and Koinkat conveys access to nothing - Enable Banking
grants access directly, to each user, at registration. Their own design
presupposes this: restricted mode with a per-user key generated in the
user's own browser only makes sense if each user is the licensee.

**Why the downside is bounded.** If EB disagreed, the consequence would be
contractual and would run against users - their remedy is to deactivate an
application, not to reach the copyright in GPL-licensed software they have
no interest in. The exposure is practical and reputational rather than
legal. That matters for the cost-benefit: a lawyer's answer would not bind
EB, and EB's answer would.

**Decision taken.** Ask EB directly rather than buy an opinion. Proceed on
the current reading unless they object.

### The email

> To: support.api@enablebanking.com
> Subject: Distribution model and redirect URI options for a personal-use desktop app
>
> Hello,
>
> I maintain Koinkat, a free open-source desktop personal-finance app. It
> ships no credentials of any kind. Each user creates their own Enable
> Banking account, registers their own Application, generates their own
> private key (which stays in their OS credential store and is never
> transmitted), and activates in restricted mode by linking their own
> personal accounts. The app is a client that speaks your API against
> whatever application the user has registered themselves.
>
> Two questions.
>
> 1. Does distributing software designed to be pointed at each user's own
>    Enable Banking application raise any issue under your Terms of Service?
>    I read the non-transfer clause as binding the Control Panel user in
>    respect of your Control Panel and API, and not reaching a third party's
>    own client software - but the terms do not address the situation
>    directly and I would rather ask than assume.
>
> 2. What redirect URI schemes does application registration accept? For a
>    native desktop app, RFC 8252 recommends either a private-use URI scheme
>    (e.g. `koinkat://auth-callback`) or a loopback redirect
>    (`http://127.0.0.1:<port>/`), both of which keep the authorization code
>    off any hosted page. Do you support either? Today we redirect to a
>    static page that immediately hands the code to the app via a deep link,
>    and I would prefer to remove that hop entirely.
>
> Happy to provide the source, which is public.
>
> Thanks,
> Marco Sburlino

The answer to the second question may be worth more than any legal opinion
in this file, because a yes removes the only real GDPR question the project
has.

---

## 4. Controller and processor in the user-Enable-Banking relationship

**Resolved as far as it affects Koinkat.**

The relevant instrument is the EDPB's Guidelines 06/2020 on the interplay
between PSD2 and the GDPR, which the original review did not reach. Its
paragraph 12 addresses the point: depending on circumstances, payment
service providers may be either controllers or processors.

`UNVERIFIED`: that characterisation of paragraph 12 was not checked against
the Guidelines text in this pass.

The stronger argument is structural. An AISP with its own authorisation, its
own security and record-keeping obligations, and its own supervisory
relationship with FIN-FSA is not plausibly processing on someone else's
behalf and to someone else's account. So the review's original guess -
controller - was right, and its stated confidence was too low.

**But it does not matter much for Koinkat**, which is not a party to that leg
and cannot characterise it authoritatively. The defect the review actually
found is small and fixable: the privacy policy pointed users at EB's privacy
notice, but that notice covers only their website and Control Panel, so a
user looking for what happens to their *account data* would not find it.

**Resolved by fixing the pointer**, not by asserting EB's GDPR role. The
privacy policy now names both documents and says what each covers, states
that EB is an authorised AISP supervised by FIN-FSA and responsible for that
processing in its own right, and states that Koinkat is not a party to it.

---

## 5. What must ship with the binaries to satisfy notice requirements?

**Resolved and implemented.**

The requirements, by licence:

- **MIT** - the copyright notice and permission notice must be retained in
  all copies or substantial portions. A compiled binary containing the
  software is such a copy.
- **BSD-2-Clause and BSD-3-Clause** - clause 2 is explicit about binaries:
  redistributions in binary form must reproduce the copyright notice,
  conditions and disclaimer in the documentation or other materials provided
  with the distribution. This is the clearest textual basis for shipping a
  notice file rather than relying on the repository.
- **Apache-2.0** - section 4 requires giving recipients a copy of the licence
  and retaining attribution notices.
- **OFL-1.1** - condition 2 permits bundling and redistribution with
  software, conditioned on each copy carrying the copyright notice and the
  licence. Embedding `.woff2` files into the binary is bundling, so the OFL
  text must travel with the binary rather than sitting in `node_modules` on
  the build machine.
- **CDLA-Permissive-2.0** - one obligation: the agreement text must
  accompany the shared data. See question 7.

`UNVERIFIED`: these summaries are from the licence texts as generally
understood and were not re-derived clause by clause in this pass.

**What shipped.** `THIRD-PARTY-LICENSES.md`, generated from both lockfiles by
`npm run licenses`, covering 64 shipped npm packages and 486 crates. It is a
Tauri bundle resource, so it lands on disk beside the binary; verified by
extracting the built MSI and finding it under `PFiles\Koinkat\`. CI
regenerates it and fails if it differs from what is committed, and the
release workflow runs the same check.

On the OFL Reserved Font Name question the original review flagged: the
notice is generated from each `@fontsource` LICENSE file rather than
transcribed, which surfaced that **DM Serif Display carries a Reserved Font
Name ('Source'), inherited from Adobe's Source Serif**. A hand-written table
would have missed it. The fonts are distributed under their existing names,
so clause 3 is not engaged, and the generated file says so.

Also worth noting, since the review framed this purely as a third-party
obligation: GPL-3.0 section 5 requires the work to carry appropriate legal
notices, so the file serves the outbound licence too.

**Related gap, now closed:** the review ran no vulnerability scan at all.
`npm audit` and `cargo audit` now run in CI, scoped to what actually ships.

---

## 6. Does the setup guide reproduce Enable Banking's documentation?

**Resolved. No, and the analysis is not close.**

Copyright protects expression, not facts, procedures or methods of
operation. A step-by-step description of how to operate someone else's web
interface is a description of a procedure. Button labels, screen names and
field names are short functional terms. To the extent that describing the
workflow accurately requires EB's terminology, that is the idea-expression
distinction doing ordinary work. Independently written prose describing a
third party's UI is what every tutorial and integration guide consists of.

`UNVERIFIED`: the copyright principles above are stated from general
understanding, not from a cited authority.

**Screenshots checked, since the review only assessed the prose.** There are
none. `BankSetupGuide.tsx` references no images at all; `docs/images/`
contains only a placeholder README; and `src/assets/` contains only
Koinkat's own logo files. So the separate question of reproducing EB's
visual design does not arise.

**Hardening applied.** The more plausible complaint was never copyright - it
is implied affiliation, which is a trademark question. A muted note now sits
at the top of the guide disclaiming affiliation, attributing the trademark,
and dating the described interface so that EB redesigning it does not turn
stale steps into a false claim about their product.

---

## 7. Is CDLA-Permissive-2.0 compatible with GPL-3.0 outbound?

**Resolved. Compatible. `webpki-roots` is safe to keep.**

CDLA-Permissive-2.0 is a short permissive data licence. It grants use,
modification and sharing, and imposes one obligation: a recipient who shares
the data must make the agreement text available with it, including the
warranty and liability disclaimers. There is no copyleft, no reciprocal
licensing and no field-of-use restriction, and the 2.0 text is explicit that
it imposes no obligations on results obtained from computational use
(<https://cdla.dev/permissive-2-0/>).

Nothing there conflicts with distributing a larger work under
GPL-3.0-or-later. The absence of an FSF compatibility opinion, which the
review noted, reflects the licence's youth and its data-rather-than-code
subject matter rather than a known problem.

**Its one obligation is a notice obligation**, so the answer folds into
question 5: the CDLA text is included in `THIRD-PARTY-LICENSES.md`.

---

## 8. GitHub Pages request logs - what is retained, and who can read it?

**Resolved, and it corrected an error in the review.**

GitHub's Pages documentation states that when a site is visited "the
visitor's IP address is logged and stored for security purposes", regardless
of whether the visitor is signed in
(<https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages>).

Two things follow, and the second is the important one:

1. **GitHub does the logging, for GitHub's stated purpose** - security. Not
   the maintainer's purpose, and not at the maintainer's direction.
2. **GitHub provides no access logs to Pages site owners.** There is no log
   export, no request analytics and no server-side statistics for Pages.
   Repository traffic insights cover repository activity - pushes, clones,
   referrers - not HTTP requests to the published site. Standing community
   feature requests asking GitHub to expose request logs are good evidence
   the capability does not exist.

So the maintainer neither holds nor can obtain a record of authorization
codes. This materially weakens the strongest argument against the project's
privacy position - see question 1.

**Still unestablished:** the exact retention period, and whether query
strings specifically are retained as opposed to the IP and path. Only GitHub
Support can answer that. It is worth an email for completeness but does not
move the analysis, because what matters for controllership is that the
maintainer has no access and determines no purpose.

---

## 9. Trademark: register "Koinkat", and does "Koink" matter?

**Closed by decision. No registration for now.**

The prior question was whether a registration is wanted at all. An EUTM in
one class costs EUR 850 at e-filing plus any attorney fees, renewable every
ten years. It buys the ability to stop others, which is worth something only
if the money would actually be spent enforcing. For a free GPL project with
no revenue, the offensive case is nil. The defensive case is real - a
registration stops someone else registering the name and forcing a rename -
but it is a judgement about attachment to the name, not a legal question.

**Decision taken.** No registration. Revisit only if the project starts
taking money, or if a third-party filing for a similar mark appears.

Recorded for whenever it is revisited:

- **Registrability looks fine on absolute grounds.** "Koinkat" is an invented
  word, not descriptive of personal-finance software, not generic, not
  laudatory. The crowding of the "Koin-" stem in fintech affects relative
  grounds and enforcement breadth, not absolute grounds.
- **Class 9 is right; class 36 probably is not.** Class 9 covers downloadable
  software. Class 36 covers financial services, which Koinkat does not
  provide - claiming it invites a no-genuine-intention-to-use objection and
  needlessly widens the collision surface. Class 42 would be a better second
  class than 36 if breadth were ever wanted.
- **"Koink" is a smaller problem than it looks.** EUIPO does not refuse on
  relative grounds of its own motion; a third party must oppose within three
  months of publication, and to do so needs an earlier right effective in the
  EU. The TMview search found no registration, and an iOS app on the US App
  Store is thin evidence of use in trade in the EU. Not "no risk", but a long
  way from a bar.

`UNVERIFIED`: registrability and opposition practice are specialist
judgements and nothing above should be relied on.

**Outstanding, free, and not yet done:** the review's own stated gap - WIPO's
Global Brand Database and EUIPO eSearch were never searched separately from
TMview. Worth twenty minutes before any future decision.

---

## Corrections to the review

Both of these pointed in the more alarming direction, which is the worse way
for an evidence base to be wrong.

**1. The CRA donations language is Recital 15, not Recital 18.** The review's
"Scope exclusions" section attributed the monetisation and donations rule to
Recital 18 and flagged the donations treatment as `NEEDS-HUMAN-CHECK`. The
Recital 18 quote it used - "not monetised by their manufacturers" - is
genuine and correctly quoted, but the donations rule is in Recital 15, and
Recital 15 answers the question outright rather than leaving it open.
Recital 18 covers the development-versus-supply distinction and the
irrelevance of how development was financed. Anyone following the original
citation looking for the donations rule would not have found it. Corrected
in the review, and the review's practical advice to withhold any funding
link until this was resolved is withdrawn.

**2. The maintainer does not hold a log of authorization codes.** The
original question 8 said that if logs were "retained and accessible", the
maintainer would hold one "at least nominally", and the review carried the
same implication at section 1.5 and in Task 2 Q5. GitHub provides no request
logs to Pages site owners in any form. The accurate statement is that GitHub
logs request data for its own security purposes under its own privacy
statement, and the maintainer has no access and no means of obtaining it.
Corrected in all three places.
