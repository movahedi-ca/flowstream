# Contributing to FlowStream

Thanks for considering a contribution. This is a small, honest project — keep it that way.

## How to contribute

1. Fork the repo: https://github.com/movahedi-ca/flowstream
2. Create a branch from `main` with a descriptive name (`feature/anki-export`, `data/python-curriculum`, ...).
3. Make your change. Keep the frontend dependency-free (see style rules below).
4. Run the checks: `npm test` and `npm run smoke`.
5. Open a pull request against `main` with a clear description of what changed and why.

Small PRs are preferred. One idea per PR.

## Code style

- **Vanilla JS, zero dependencies on the frontend.** `docs/` must stay build-step-free:
  no bundlers, no transpilers, no npm packages shipped to the browser. If you can
  do it in plain ES2020, do it.
- Keep functions small and named for what they do. Comments explain *why*, not *what*.
- No external network calls from the demo app except where the user explicitly
  opts in (e.g. BYOK LLM definitions, which must ask before sending anything).
- `localStorage` is the only persistence in the demo. Never send user data anywhere.

## Adding lessons to the curriculum

Lesson data lives in `docs/data/curriculum.json`. Each lesson follows this shape:

```json
{
  "id": "unique-string-id",
  "title": "Lesson title",
  "url": "https://example.com/video",
  "durationSec": 600,
  "track": "track-id",
  "prerequisites": ["lesson-id-..."],
  "chapters": [
    { "title": "Intro", "startSec": 0, "kind": "fluff" },
    { "title": "The core idea", "startSec": 90, "kind": "content" }
  ],
  "efficacy": 0.8,
  "actionDensity": 0.7,
  "terms": [{ "term": "closure", "definition": "..." }]
}
```

Rules for curriculum PRs:

- Only link videos you have actually watched, or clearly mark unverified entries.
- Chapter `kind` must be one of `fluff` or `content` — fluff chapters power fluff-bypass, so be honest about labeling.
- `efficacy` and `actionDensity` are numbers between 0 and 1; include a one-line
  note in your PR explaining how you estimated them.
- `terms` feed the local jargon glossary; keep definitions short and correct.

## Running tests

```bash
npm test        # full test suite
npm run smoke   # smoke checks (also run by CI)
node --check docs/app.js   # syntax-check the demo app
```

All of these run in CI on every push and PR to `main`. Don't open a PR with a red suite.

## Code of Conduct

Be kind and assume good faith. No harassment, no personal attacks, no spam.
Disagree with ideas, not people. Maintainers may remove contributions or ban
participants who make the space hostile. Report problems by opening an issue
titled "Code of conduct concern".

## License

By contributing, you agree your work will be released under the MIT License
(see `LICENSE`).
