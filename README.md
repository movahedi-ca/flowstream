# FlowStream

[![CI](https://github.com/movahedi-ca/flowstream/actions/workflows/ci.yml/badge.svg)](https://github.com/movahedi-ca/flowstream/actions/workflows/ci.yml)
[![Demo](https://img.shields.io/badge/demo-live-2ea44f)](https://movahedi-ca.github.io/flowstream/)

A productivity-only, distraction-free video learning platform. Watch less, learn more.

## Try it now

**Live demo:** [movahedi-ca.github.io/flowstream](https://movahedi-ca.github.io/flowstream/)

The demo is a static site (GitHub Pages). Everything runs in your browser — no account, no signup, no tracking.

## Quickstart

```bash
git clone https://github.com/movahedi-ca/flowstream.git
cd flowstream
npm run dev      # serves docs/ at http://localhost:4173
npm test         # run the test suite
```

`npm run dev` starts a static server for the demo app in `docs/`.
`npm test` runs the test suite (zero build step — the app is vanilla JS).

## Features

What the demo actually does today:

- [x] **Intent-based discovery** — say what you're trying to learn, get matched lessons, not an algorithmic feed.
- [x] **Focus sessions** — timed, interruption-resistant viewing sessions.
- [x] **Curriculum view** — lessons grouped into ordered tracks instead of loose videos.
- [x] **Fluff-bypass** — skip past intros, sponsorships, and filler via labeled chapters.
- [x] **Timestamped markdown notes + export** — notes pinned to video timestamps, exportable as Markdown.
- [x] **Split-screen sandbox** — try the skill alongside the video, side by side.
- [x] **Anki flashcard export** — turn notes and key points into `.tsv` for Anki import.
- [x] **Jargon translator** — local glossary of domain terms plus BYOK (bring your own key) for optional LLM-powered definitions. Keys stay in your browser.
- [x] **Devil's-advocate recall triggers** — mid-session prompts that challenge what you just learned.
- [x] **Ulysses pacts ledger** — pre-commitments you make to your future self, tracked in a local ledger.
- [x] **Skill trees with prerequisite gating** — lessons unlock only when prerequisites are complete.
- [x] **Intent slider + efficacy + action-density ranking** — rank lessons by how well they match your intent, measured learning efficacy, and how actionable the content is.

## Architecture

```
┌─────────────┐      ┌──────────────────────┐
│ Browser SPA │ ◄─── │ docs/app.js + index  │  static, zero-dep
│ (docs/)     │      │ bundled JSON data    │  docs/data/curriculum.json
└──────┬──────┘      └──────────────────────┘
       │ localStorage
       │ (all user state: notes, pacts, progress, keys)
       ▼
┌─────────────┐
│ Optional    │  not required — demo works fully without it
│ Express API │  server/ : experiments + smoke-test targets
└─────────────┘
```

No backend is required. The demo is a static single-page app; all user state
(notes, pact ledger, skill-tree progress, glossary, API keys) lives in
`localStorage` and never leaves the device. The optional Express API in
`server/` exists for experimentation only.

## Honest labeling

- The bundled curriculum in `docs/data/curriculum.json` is **sample content** for
  demonstrating the platform. It is not a reviewed or accredited course catalog.
- Roadmap extension points are **not implemented**: a crypto/fiat wallet and
  wearable biofeedback integration do not exist in this repo. See
  [docs/EXTENSION_POINTS.md](docs/EXTENSION_POINTS.md) for the honest
  engineering notes on how a contributor could build them.

## Project structure

```
flowstream/
├── docs/                 # static demo app (GitHub Pages)
│   ├── index.html
│   ├── app.js
│   ├── social-card.svg
│   ├── EXTENSION_POINTS.md
│   └── data/
│       └── curriculum.json   # sample curriculum (see schema note in CONTRIBUTING.md)
├── server/               # optional Express API (not required for the demo)
├── tests/                # test suite (npm test)
├── .github/workflows/ci.yml
├── CONTRIBUTING.md
├── DISCUSSION_DRAFT.md   # draft launch discussion text (not published automatically)
├── LICENSE
└── README.md
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions of all kinds welcome:
code, curriculum data, design, docs, bug reports.

## License

[MIT](LICENSE) © 2026 Mohammad Movahedi.
