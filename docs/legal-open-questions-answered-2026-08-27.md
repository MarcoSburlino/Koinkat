# Koinkat - open legal questions, worked through

Date: 2026-08-27
Companion to `legal-review-2026-08-26.md` and `legal-open-questions.md`.
Author: not a lawyer. Same standard as the review - primary sources with URLs
where they exist, and explicit flags where they do not.

> **Provenance.** This document was produced separately from the review and
> committed to the repository afterwards. Its two corrections to the review
> were independently checked before being applied: the CRA donations rule was
> verified against the Official Journal text of Regulation (EU) 2024/2847
> (it is **Recital 15**), and the GitHub Pages logging position was verified
> against GitHub's own Pages documentation. Its other citations - the
> Commission's Article 26 guidance and its paragraph and example numbers, and
> EDPB Guidelines 06/2020 paragraph 12 - were **not** independently verified,
> and should be treated as `UNVERIFIED` under this project's own rule. Only
> the em dashes and one malformed citation tag were edited, for house style.

**What this changes.** Six of the nine questions turned out to be answerable
from primary sources that the review either did not reach or cited slightly
wrong. Two remain genuinely open, and one is an email to Enable Banking rather
than a legal question at all.

Two corrections to the review itself are recorded at the bottom. Both matter,
because the review is meant to be an evidence base and both errors point the
wrong way.

---

## Status after this pass

| # | Question | Status |
|---|---|---|
| 1 | Callback page / GDPR controllership | **Narrowed substantially.** Still the one worth a lawyer's time, but the question is now much smaller. |
| 2 | CRA carve-out and donations | **Closed.** Commission guidance of 27 July 2026 answers all three parts. Donations are fine. |
| 3 | EB terms and distribution | **Open - but not for a lawyer.** Email EB. Draft below. |
| 4 | Controller/processor in the user-EB leg | **Closed for Koinkat's purposes.** The answer doesn't change what Koinkat should do; a documentation fix does. |
| 5 | Third-party licence notices | **Closed on substance.** Concrete requirements and tooling below. |
| 6 | Setup guide vs EB's documentation | **Closed.** Low risk, and a one-line disclaimer closes the more plausible complaint. |
| 7 | CDLA-Permissive-2.0 vs GPL-3.0 | **Closed.** Compatible. But it adds a notice obligation that belongs in question 5's file. |
| 8 | GitHub Pages edge logs | **Closed.** The maintainer holds nothing and has no way to obtain it. |
| 9 | Trademark | **Open, but the prior question is whether to register at all.** |

Net: one lawyer question, one email to EB, one email to GitHub if you want
belt-and-braces, and a short list of things to fix in the repo.

---

## 2. Donations and the Cyber Resilience Act - closed

This is the time-sensitive one, so it goes first. The answer is more favourable
than the review's best guess, and it comes from a document published on
**27 July 2026** - after the sources the review consulted.

The Commission adopted its Article 26 guidance as the Annex to Commission
Decision C(2026) 5252 final. Section 3 is entirely about free and open-source
software, and section 3.2.4 is entirely about donations.

### (a) Is Koinkat outside scope today?

Yes, and the guidance lets you say why precisely rather than approximately.

Note first that Koinkat **is** a product with digital elements. Example 4 of the
guidance is almost a description of Koinkat: a desktop application built with web
technologies but packaged for local installation is supplied to the user and
executes on their device, and is therefore a product with digital elements - but
only falls in scope where it is placed on the market in the course of a
commercial activity.

So the correct framing is not "Koinkat isn't a product the CRA covers." It is
"Koinkat is a product with digital elements that is not placed on the market,"
because there is no commercial activity. Paragraph 23 confirms that sharing free
and open-source code on a public repository is generally not placing it on the
EU market.

One further point that closes a gap the review didn't reach: the "open-source
software steward" category in Article 3(14) applies to **legal persons only**.
Paragraph 53 states that where the entity is a natural person, the free version
is not within the CRA's scope. A solo maintainer who is a natural person cannot
be pulled in as a steward instead of a manufacturer. That route is closed.

### (b) Would a donation button forfeit it?

**No.** Paragraph 61 is unusually direct. Merely including a link to a donation
platform is not to be viewed as an intention to make a profit - and the guidance
says this holds "even where the amount collected exceeds the costs of design, development and provision". It goes on to say that FOSS
supported only through donations is unlikely to be considered placed on the
market. Example 20 is the exact scenario: a public repo, a voluntary donation
link, access not conditional on donating - not placed on the market.

The line that *does* forfeit the carve-out is drawn at paragraph 62 and
illustrated by Examples 21 and 22. Donations become monetisation where they are
in practice equivalent to charging a price. Concretely:

**Safe:** a GitHub Sponsors button, an Open Collective, a "buy me a coffee"
link, one-off or recurring donations, a thank-you list in the README, donations
that exceed your costs.

**Not safe:** donor-only builds; releases or security updates supplied only to
donors; early access to versions; conditioning any essential functionality on
donating; donations tied to contractual benefits or exclusive advantages beyond
ordinary community perks.

Also worth knowing, from section 3.2.5: third-party financing of development -
grants, sponsorships, paid feature work - does not by itself make the software
commercial, as long as the result is openly shared and not otherwise monetised.
Example 23 covers a company paying you to add a feature.

The review's practical suggestion - "do not add any funding channel until this
is answered" - can be retired. It is answered.

### (c) What would attach if the carve-out were lost?

Hypothetical now, but for completeness: from 11 September 2026, the Article 14
reporting duties (actively exploited vulnerabilities and severe incidents, to
ENISA and the relevant CSIRT, on the 24-hour/72-hour/14-day cascade). From
11 December 2027, the full manufacturer regime - Annex I essential requirements,
cybersecurity risk assessment, conformity assessment, CE marking, technical
documentation, a declared support period, and an SBOM.

### The caveat

Paragraph 8 states the guidance is not binding and that only the CJEU can give an
authoritative interpretation. That is true of all Commission guidance. But this
is the Commission's settled interpretive position, market surveillance
authorities are the ones who would enforce, and the language on donations is
about as unambiguous as EU guidance gets. Short of litigation, this is the best
answer available.

**Source:** Commission Decision C(2026) 5252 final, Annex, 27 July 2026,
section 3 (paras 40-89). Consolidated summary at
<https://digital-strategy.ec.europa.eu/en/policies/cra-open-source>.

---

## 8. GitHub Pages edge logs - closed

Taking this before question 1, because it is a premise of it.

GitHub's own Pages documentation states that when a Pages site is visited, the
visitor's IP address is logged and stored for security purposes, regardless of
whether the visitor is signed in
(<https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages>,
"Data collection"). It points to the GitHub Privacy Statement for the rest.

Two things follow, and the second is the important one.

**GitHub does the logging, for GitHub's stated purpose.** Security. Not yours,
not at your direction.

**GitHub provides no access logs to Pages site owners.** There is no log export,
no request analytics, no server-side statistics for Pages. This is verifiable
indirectly but decisively: an entire cottage industry of third-party analytics
tools exists specifically because Pages owners get nothing from GitHub. The
repository audit log records repository *events* - pushes, permission changes,
deploys - not HTTP requests to the published site, and it is an organisation and
enterprise feature besides.

So the position is: **you do not hold a log of authorization codes, and you have
no mechanism to obtain one.** GitHub holds request data, for its own purposes,
under its own privacy statement, exactly as it does for every one of the millions
of Pages sites.

Still unestablished, and only GitHub Support can say: the exact retention period
for edge request data, and whether query strings specifically are retained as
opposed to just the IP and path. Worth an email if you want it airtight, but it
does not move the analysis much - what matters for question 1 is that you have
no access and determine no purpose.

---

## 1. Does hosting the callback page make you a controller? - narrowed

The honest answer is still "ask a lawyer." But the question is now considerably
smaller than the review left it, for three reasons.

**First, the premise about logs was wrong.** The review says that if logs are
retained and accessible, the maintainer holds "at least nominally" a log of
authorization codes. Question 8 establishes that he does not, in any sense -
nominal or otherwise. What remains of the concern is only "you chose the
default host," not "you hold the data."

**Second, look at what is actually in that log line.** The authorization code is
an opaque random string that identifies nobody. It sits in a log entry next to
an IP address - and *the IP* is the personal data. But that IP is logged by
GitHub on every request to every Pages site, for GitHub's own security purposes,
identically to a site that serves nothing but a plain HTML page. Stripping the
code from the equation, the residual question is: "my host logs visitors' IP
addresses." Which is true of every website that has ever existed. The code adds
nothing to the identifiability of the data subject; it only adds sensitivity, and
it is inert without an RS256 key you never had.

**Third, the case law that would be used against you cuts less than it looks.**
The two decisions a lawyer will reach for are *Fashion ID* (C-40/17) and
*Wirtschaftsakademie* (C-210/16), both of which found joint controllership on
facts that look superficially similar - someone embedded or nominated a
third-party component and got swept in. But both turned on the operator
obtaining a *benefit* from the processing, serving the operator's *own purpose*:
the retailer's Like button gave it advertising value, and the fan-page admin got
audience statistics. Neither is present here. You receive nothing, learn nothing,
and the processing serves no purpose of yours beyond bouncing a browser back to
the user's own machine. The EDPB's Guidelines 07/2020 also distinguish essential
means from non-essential means; choosing which static host serves a redirect page
sits closer to implementation detail than to determining the purposes and
essential means of processing.

`UNVERIFIED` - the case characterisations above are from general knowledge and
were not checked against the judgment texts in this pass. They are here to show
the lawyer where the argument runs, not to substitute for one.

### The remedy is worth more than the answer

If you can stop routing the code through a hosted page at all, the question
dissolves and you never need to pay for it to be answered.

RFC 8252, *OAuth 2.0 for Native Apps*, is the relevant standard and it addresses
exactly this. It recommends two redirect patterns for native applications, both
of which keep the authorization code off any third-party host:

1. **A private-use URI scheme** - `koinkat://auth-callback` registered directly
   as the redirect URI, so the browser hands the code straight to the app. You
   already have this deep link; today it is the second hop rather than the first.
2. **A loopback interface redirect** - `http://127.0.0.1:{random-port}/`, with
   the app listening on an ephemeral port for the duration of the flow. This is
   the pattern most desktop OAuth clients use.

Either would make the hosted page unnecessary. Whether Enable Banking accepts
them is the open technical question - I could not establish EB's redirect URI
validation rules from their public documentation, and many PSD2 aggregators do
require an `https` redirect, which is very likely why the hosted page exists in
the first place.

**So: ask EB.** Fold it into the same email as question 3 - draft below.

If EB requires `https`, the fallback is the review's own suggestion: make
self-hosting the documented default rather than the alternative, so the
maintainer-registered host stops being the path almost everyone takes.

### If a lawyer says "joint controller" anyway

Worth knowing that the consequences are modest. There is no data to give access
to, nothing to erase, nothing to port, no profiling, no international transfer
you arrange. In practice it would mean a paragraph in the privacy policy naming
the callback host and what it does, and a joint-controller arrangement you cannot
realistically negotiate with GitHub - which is itself an argument that the
characterisation doesn't fit. It would not require a DPO, a DPIA, or a
representative.

---

## 4. Controller and processor in the user-EB relationship - closed enough

The relevant instrument is **EDPB Guidelines 06/2020 on the interplay between
PSD2 and the GDPR**, which the review didn't reach. Its paragraph 12 addresses
this directly: depending on the circumstances, payment service providers may be
either controllers or processors. Consultation responses on that paragraph argued
that PSPs - ASPSPs, AISPs and PISPs alike - are always controllers, never
processors, because PSD2 imposes obligations on each PSP directly and a processor
cannot hold statutory duties it is not free to take instructions on.

So the review's best guess was right and its confidence was too low. An AISP with
its own authorisation, its own security obligations, its own record-keeping
duties and its own supervisory relationship with FIN-FSA is not plausibly
processing on someone else's behalf and nobody else's account.

**But here is the more useful point: it does not matter much for Koinkat.**

Koinkat isn't party to that leg and can't characterise it authoritatively.
The defect the review actually found is real, small, and fixable in two
sentences - the privacy policy points users at EB's privacy notice, but that
notice covers only the website and Control Panel. A user following the pointer
looking for what happens to their *account data* will not find it.

**Fix:** point at both documents and say what each covers.

> Enable Banking publishes two relevant documents. Their
> [privacy notice](https://enablebanking.com/privacy/) covers their website and
> Control Panel - the account you create with them. Their
> [End User terms](https://tilisy.enablebanking.com/terms) cover the account and
> transaction data itself, and state that this data passes through their API
> rather than being stored there, while your authentication tokens and consent ID
> are retained. Enable Banking is an authorised AISP supervised by the Finnish
> FIN-FSA and is responsible for that processing in its own right; Koinkat is not
> a party to it and receives none of it.

Don't assert EB's GDPR role beyond that last clause. Describe the flow, link the
documents, say what each covers.

---

## 5. What must ship with the binaries - closed on substance

The review's best guess is right. Here is the detail it flagged as missing.

**MIT.** The copyright notice and the permission notice must be retained in all
copies or substantial portions of the software. A compiled binary containing the
software is such a copy.

**BSD-2-Clause and BSD-3-Clause.** Clause 2 is explicit about binaries:
redistributions in binary form must reproduce the copyright notice, the list of
conditions and the disclaimer in the documentation and/or other materials
provided with the distribution. This is the clearest textual basis for shipping a
notice file rather than relying on the repository.

**Apache-2.0.** Section 4 requires giving recipients a copy of the licence,
retaining copyright/patent/trademark/attribution notices in the source form of
any derivative, and - where the work includes a `NOTICE` file - reproducing its
attribution notices in the distribution.

**OFL-1.1.** The review is right that this is the sharpest case. Condition 2
permits the fonts to be bundled and redistributed with software, but conditions
that on **each copy containing the copyright notice and the licence**. Embedding
the `.woff2` files into the binary is bundling; the OFL text must travel with the
binary, not merely sit in `node_modules` on your build machine.

One wrinkle the review didn't reach: condition 3, the Reserved Font Name clause.
It bites on *modified* versions. `@fontsource` ships pre-subset `.woff2` files,
and subsetting is arguably modification. In practice `@fontsource` is a
widely-used, upstream-tolerated distribution channel and this has not been
treated as a problem by anyone - but if you want it airtight, the fix is
trivially cheap: the notice file names the fonts, their copyright holders,
reproduces the OFL text, and states that the files are subset for web delivery
and are unmodified in outline.

**CDLA-Permissive-2.0** (see question 7) adds one line: the agreement text must
be made available with the shared data. Same file.

### The answer

A generated `THIRD-PARTY-LICENSES.md`, shipped inside the installer so it lands
on disk beside the binary, satisfies all of the above. Linking it from the
repository is good practice but is not what discharges the obligation - the file
has to accompany the distributed binary.

An in-app "Licenses" screen is **not required** by any of these licences. But
Tauri makes it a small job (bundle the file as a resource, render it in Settings)
and it is the visible, checkable version of compliance. Worth doing, not urgent.

One angle the review didn't mention: this isn't purely a third-party obligation.
GPL-3.0 §5 requires the work to carry appropriate legal notices, so a notice file
is tidiness for your own outbound licence too.

### Tooling, and the coverage gap

The review's Rust pass covered 408 of 617 crates because cargo only fetches
crates for the current target. `cargo-about` fixes this properly - it reads the
crates.io index rather than the local cache and accepts a `[targets]` list in
`about.toml`, so one run on any machine covers Windows, macOS and Linux. Pair it
with `license-checker-rseidelsohn` or `oss-attribution-generator` for the npm
tree, concatenate, and wire it into the release workflow so the file can never
drift from the lockfiles.

While you are there: the review found **no CVE scan was run at all**. `cargo
audit` and `npm audit` in CI cost nothing and close a gap that is larger than any
question in this document.

---

## 7. CDLA-Permissive-2.0 and GPL-3.0 - closed

Compatible. `webpki-roots` is safe to keep.

CDLA-Permissive-2.0 is a short, genuinely permissive data licence. It grants use,
modification and sharing, and imposes **one** obligation: a recipient who shares
the data must make the text of the agreement available with it, including the
warranty and liability disclaimers. There is no copyleft, no reciprocal
licensing, no field-of-use restriction, and the 2.0 text is explicit that it
imposes no obligations on results obtained from computational use of the data.

Nothing in that conflicts with distributing a larger work under GPL-3.0-or-later.
The absence of an FSF opinion the review noted reflects the licence's youth and
its data-rather-than-code subject matter, not a known problem.

**But it is not a free pass.** That single obligation is a notice obligation, and
you are currently not meeting it for the same reason you are not meeting MIT's or
OFL's - there is no notice file. So question 7's answer is: compatible, and it
goes in question 5's file.

Licence text: <https://cdla.dev/permissive-2-0/>

---

## 6. Does the setup guide reproduce EB's documentation? - closed

No, on the facts the review established, and the analysis is not close.

Copyright protects expression, not facts, procedures, systems or methods of
operation. A step-by-step description of how to operate someone else's web
interface is a description of a procedure. Button labels, screen names and field
names are short functional terms that generally attract no copyright at all, and
to the extent that describing the workflow accurately *requires* using EB's
terminology, that is the idea-expression dichotomy doing its ordinary work.
Independently written prose describing a third party's UI is exactly the thing
that every review, tutorial and integration guide on the internet consists of.

What would create risk is copied prose or copied screenshots. The review found
the guide reads as original prose. **Worth confirming there are no screenshots of
the Control Panel in `BankSetupGuide.tsx` or its assets** - the review doesn't say
either way, and screenshots are a different question from prose (they reproduce
EB's own visual design, and the fair-dealing/fair-use analysis for a UI
screenshot in an instructional context is favourable but not automatic).

### The cheap hardening

The more plausible complaint from EB was never copyright - it is implied
affiliation or endorsement, which is a trademark question. One line at the top of
the guide addresses both at once:

> Koinkat is not affiliated with, endorsed by, or sponsored by Enable Banking Oy.
> "Enable Banking" is a trademark of Enable Banking Oy. This guide describes their
> Control Panel as it appeared in August 2026; their own documentation at
> enablebanking.com/docs is authoritative and may have changed.

Using EB's name to describe what your software interoperates with is nominative
use and entirely ordinary. The disclaimer removes the sponsorship inference and
the "as it appeared" clause protects you if EB redesigns and your steps go stale.

---

## 3. Do EB's terms permit distributing this software? - still open, but email them

Your reading is right and your plan is right. Two things to add.

**The clause structure supports you.** A non-transfer clause is a standard
licensee restriction: it constrains what *the licensee* may do with *the
licensor's* assets. Its addressee is the Control Panel user, and its subject is
the Control Panel and API. A developer who never holds those assets is not the
addressee, and Koinkat conveys no access to anything - EB grants access directly,
to each user, on registration. Their own model presupposes this: the whole design
of restricted mode, with a per-user key generated in the user's browser, is built
around each user being the licensee.

**The downside is bounded.** If EB disagreed, the consequence would be
contractual, and it would run against *users* - EB's remedy is to terminate an
application, not to reach the copyright in GPL-licensed software they have no
interest in. The risk to your distribution model is practical and reputational
rather than legal. That is worth knowing before you spend money on an opinion:
the lawyer's answer wouldn't bind EB anyway, and EB's answer would.

### Draft email

Combining question 3 with the redirect question from question 1, since they go to
the same team.

> To: support.api@enablebanking.com
> Subject: Distribution model and redirect URI options for a personal-use desktop app
>
> Hello,
>
> I maintain Koinkat, a free open-source desktop personal-finance app. It ships
> no credentials of any kind. Each user creates their own Enable Banking account,
> registers their own Application, generates their own private key (which stays
> in their OS credential store and is never transmitted), and activates in
> restricted mode by linking their own personal accounts. The app is a client
> that speaks your API against whatever application the user has registered
> themselves.
>
> Two questions.
>
> 1. Does distributing software designed to be pointed at each user's own
>    Enable Banking application raise any issue under your Terms of Service? I
>    read the non-transfer clause as binding the Control Panel user in respect of
>    your Control Panel and API, and not reaching a third party's own client
>    software - but the terms don't address the situation directly and I'd rather
>    ask than assume.
>
> 2. What redirect URI schemes does application registration accept? For a native
>    desktop app, RFC 8252 recommends either a private-use URI scheme
>    (e.g. `koinkat://auth-callback`) or a loopback redirect
>    (`http://127.0.0.1:<port>/`), both of which keep the authorization code off
>    any hosted page. Do you support either? Today we redirect to a static page
>    that immediately hands the code to the app via a deep link, and I would
>    prefer to remove that hop entirely.
>
> Happy to provide the source, which is public.
>
> Thanks,
> Marco Sburlino

Their answer to question 2 may be worth more than any legal opinion in this
document, because a "yes" removes the only real GDPR question you have.

---

## 9. Trademark - the prior question first

Before registrability: **do you want a registration at all?**

An EUTM in one class costs €850 at e-filing, plus attorney fees if you use one,
renewable every ten years. That buys the ability to stop others - which is only
worth something if you would actually spend money enforcing it. For a free GPL
project with no revenue, the offensive case is nil.

The defensive case is real though, and it is the one to weigh: a registration
stops someone else registering "Koinkat" and putting you in the position of
renaming a shipped product. Whether that's worth €850 is a judgement about how
attached you are to the name and how likely you think a collision is. The
review's observation that renaming gets more expensive over time is correct.

If you decide yes, here is what I can say without being a trademark attorney.

**Registrability looks fine on absolute grounds.** "Koinkat" is an invented word.
It is not descriptive of personal-finance software, not generic, and not
laudatory, so the usual Article 7(1)(b) and 7(1)(c) EUTMR objections - devoid of
distinctive character, descriptive - don't obviously bite. The crowding of the
"Koin-" stem in fintech that the review noticed doesn't affect absolute grounds
at all. It affects *relative* grounds and, more importantly, how broadly you
could ever enforce.

**Class 9 is right; class 36 probably isn't.** Class 9 covers downloadable
software and is the correct home for a desktop app. Class 36 covers financial
services, which Koinkat does not provide - claiming it invites a bad-faith or
no-genuine-intention-to-use objection and needlessly increases your collision
surface against every fintech mark in the register. If you want a second class
for breadth, class 42 (software design, SaaS) is a better fit than 36, though for
a locally installed app class 9 alone is defensible.

**"Koink" is a smaller problem than it looks.** EUIPO does not refuse
applications on relative grounds of its own motion - a third party has to file an
opposition within three months of publication. To oppose, Koink's owner would
need an earlier right effective in the EU: an earlier registration (the review
found none), or unregistered rights protected under a member state's national law
where such protection exists. An iOS app on the US App Store is thin evidence of
use in trade in the EU. That is not "no risk," but it is a long way from a bar.

**Cheapest sequence:**

1. Close the review's own stated gap yourself, free, in about twenty minutes:
   search WIPO's Global Brand Database and EUIPO eSearch directly. The review
   flagged that neither was searched separately from TMview.
2. If you're going ahead, a proper clearance search from a trademark attorney
   (typically a few hundred euro) is worth more than any free search, because it
   covers phonetic and conceptual similarity, which TMview's "contains" search
   does not.
3. Raise "Koink" with them by name, as the review says. That instinct is right.

Note in passing that you already have public use of the name, which builds
unregistered rights in jurisdictions that recognise them and gives you a
date of first use to point at.

---

## Two corrections to the review

Both of these should be fixed in `legal-review-2026-08-26.md`, because both
point in the more alarming direction and the review is meant to be relied on.

**1. The CRA donations language is in Recital 15, not Recital 18.** The review's
"Scope exclusions" section attributes the monetisation language to Recital 18 and
quotes Recital 18's "not monetised by their manufacturers" clause. That clause is
real and correctly quoted, but the operative language about donations - donations
exceeding costs as a form of monetisation, and accepting donations without
profit-making intent not being commercial activity - is **Recital 15**. Recital 18
covers the development-versus-supply distinction, the irrelevance of how
development was financed, and the contributor carve-out. Anyone following the
review's citation to Recital 18 looking for the donations rule will not find it.

**2. The maintainer does not hold a log of authorization codes.** Question 8 of
the open-questions document says: "If it is 'retained and accessible', the
maintainer holds - at least nominally - a log of authorization codes." Both the
review (§1.5) and the GDPR analysis (Task 2 Q5) carry the same implication.
GitHub provides no request logs to Pages site owners in any form. The correct
statement is that GitHub logs request data for its own security purposes under
its own privacy statement, and the maintainer has no access to it and no means of
obtaining it. This materially weakens the strongest argument against the
project's privacy position, and the review should say so.

---

## What to do

**This week, before 11 September:** nothing for the CRA. That is the finding.
Add the Sponsors button if you want one.

**Before the next release:**
- Generate `THIRD-PARTY-LICENSES.md` and ship it inside the installer
  (`cargo-about` with a multi-target config, plus an npm licence tool).
- Add `cargo audit` and `npm audit` to CI. The review ran no vulnerability scan
  at all, and that gap is bigger than anything in this document.
- Fix the privacy-policy pointer to Enable Banking (wording in question 4).
- Add the affiliation disclaimer to `BankSetupGuide.tsx` (wording in question 6).
- Fix the silent revocation failure the review found at
  `bank-sync-service.ts:1372-1376`, and add the EB consents URL to the user guide.

**Emails to send:**
- Enable Banking, on the distribution model and redirect URI options. Draft above.
  Their answer to the second question may eliminate the need for a lawyer entirely.
- GitHub Support, on Pages edge log retention, if you want question 8 airtight.

**Ask a lawyer about:** the callback page and controllership, but only if EB says
no to both RFC 8252 redirect options. If they say yes, you change three lines of
code and the question stops existing.

**Decide, not ask:** whether the trademark registration is worth €850 to you.
That's a judgement about the name, not a legal question.
