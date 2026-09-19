# Extension Points — honest engineering notes

These are features people reasonably expect from the vision that are **not
implemented** in FlowStream today. This document exists so future contributors
can build them properly instead of bolting on something fake.

Nothing below is wired up. There are no stubs, no placeholder buttons that
pretend to work, and no mock data masquerading as a real integration.

---

## 1. Crypto/fiat wallet integration

**Status:** not implemented. No wallet code exists in this repo.

**What it would be for:** the Ulysses pacts ledger (see README) is currently
purely psychological — a promise to yourself with no enforcement. A real
extension would let a user stake funds on a pact: complete the learning goal by
the deadline or the stake goes somewhere they'd rather it didn't (a charity,
a burn address, a friend).

**Design notes for a contributor:**

- This must be **opt-in and non-custodial**. The app should never hold keys or
  move funds on the user's behalf. Use an injected provider (e.g. the user's
  own browser wallet) so signing happens client-side.
- Pacts would need an on-chain or signed off-chain representation: at minimum
  a signed message committing to (goal, deadline, stake, recipient-on-failure).
- Verification of "goal completed" is the hard part — it's an oracle problem.
  Options: self-attestation with social accountability (weak), or completion
  proofs the platform can already verify (skill-tree gates passed) signed by a
  backend the user trusts. Be explicit about which trust model you choose.
- Fiat rails (cards, bank transfer) add chargeback and custodial risk; they
  likely require a real backend and legal entity. Document that cost honestly
  before building.
- **Do not** implement a fake "wallet" that moves play-money and calls it
  staking. If it's not real funds with real consequences, it's not a Ulysses
  pact — it's a progress bar.

**Legal:** moving real money triggers money-transmitter, gambling-adjacent,
and consumer-protection questions that vary by jurisdiction. Get real advice
before shipping anything that touches funds.

---

## 2. Wearable biofeedback integration

**Status:** not implemented. No device code exists in this repo.

**What it would be for:** focus sessions currently rely on a timer and the
user's honesty. Biofeedback (heart-rate variability, electrodermal activity,
or even just phone accelerometer stillness) could give a rough, private signal
of whether a session was actually focused — feeding the efficacy scores
honestly instead of by self-report.

**Design notes for a contributor:**

- **Privacy-first or not at all.** Biometric data must be processed on-device
  and never uploaded. If a cloud model is involved, say so loudly and make it
  opt-in with plain-language consent.
- The web platform path is Web Bluetooth for HR monitors that expose the
  standard Heart Rate service — no native app required, but browser support is
  uneven (Chrome/Edge on desktop and Android; not Safari). Document what works.
- Treat the signal as *correlational, not diagnostic*. "Your HRV suggested low
  focus in chapter 3" is a prompt for reflection, not a medical claim. Never
  present it as measuring attention directly, and never store it alongside
  identity.
- Start with the dumb version: session stillness + self-reported focus ratings,
  correlated over time. It's honest, private, and already useful.

**Do not** claim focus detection you can't validate, and do not collect
biometric data "for later analysis."

---

## 3. Real LLM transcript analysis for fluff detection

**Status:** not implemented. Fluff-bypass today runs on **hand-labeled
chapters** in `docs/data/curriculum.json` (`kind: "fluff"` vs `"content"`),
curated by whoever added the lesson. There is no automatic analysis.

**What it would be for:** automatically labeling chapters (intro, sponsor
read, recap, tangents, core content) from transcripts, so fluff-bypass works
on videos nobody has hand-curated.

**Design notes for a contributor:**

- You need transcripts first. Options: platform captions APIs where ToS allow,
  or local speech-to-text on downloaded audio (check the video's license and
  the platform's terms — do not scrape in violation of ToS).
- Classification prompt design matters more than model size: define the
  chapter taxonomy (`fluff` vs `content` subtypes) with examples, ask for
  timestamps, and have the model return structured JSON you can validate.
- **Keep a human in the loop.** Auto-labels should be marked as such in the UI
  (`auto` vs `curated`) with a way for users to correct them; corrections are
  the training data for doing it better.
- Cost and key management: follow the existing BYOK pattern (user's key,
  localStorage, masked, one-click wipe) rather than proxying through a shared
  backend key. Batch and cache aggressively — transcripts don't change.
- Evaluate honestly: sample 50 auto-labeled videos, have humans label them,
  and report precision/recall on fluff detection before claiming it works.

**Do not** ship a "fluff detector" that's a keyword blacklist and call it AI.
