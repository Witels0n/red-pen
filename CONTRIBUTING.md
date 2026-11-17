# Contributing to Red Pen

Thanks for helping make teachers' lives easier. Bug reports, tool ideas and pull requests are all
welcome.

## Ground rules

1. **Nothing leaves the browser.** No network requests, analytics, remote fonts, CDNs or relaxations
   of the Content Security Policy. Read [ADR 0001](docs/adr/0001-client-only-processing.md) before
   proposing anything that touches files or storage.
2. **No learner data in issues or tests.** Use generated fixtures with made-up names.
3. **Use the project's language.** Terms in [GLOSSARY.md](GLOSSARY.md) are used consistently in code
   and UI. UI text is in South African English.

## Workflow

1. Fork the repo and create a branch from `main`.
2. `npm install`, then `npm run dev`.
3. Make the change, with tests:
   - pure logic gets Vitest unit tests in `tests/`
   - behaviour in the browser gets a Playwright spec in `smoke/`
4. Run `npm run check` and `npm run test:smoke`.
5. Open a pull request using the template. Pull requests are squash-merged, so the title becomes
   the commit message on `main`: write it in the imperative ("Add a seating plan tool").

## Larger changes

For a new tool or a change to how files, storage or offline behaviour work, open an issue first.
Significant decisions are recorded as ADRs in `docs/adr/`, and larger features get a spec in
`docs/specs/`.
