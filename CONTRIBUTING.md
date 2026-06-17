# Contributing to spec-renderer

Thanks for considering a contribution. This project follows the
"few defaults applied widely" coding standard locked 2026-04-16. Below
is the minimum you need to know to land a change.

## Quick start

1. Fork and clone.
2. `just bootstrap` — installs pre-commit hooks (Decision 9).
3. Make your change in a topic branch: `<type>/<scope>-<short-desc>`
   (e.g. `feat/auth-passkey`, `fix/api-timeout`).
4. Conventional Commits, signed: `git commit -s` (the `-s` adds a
   Signed-off-by footer; the SSH-key signature is added automatically
   from `.gitconfig`).
5. `just check` locally before pushing — it runs `fmt`, `lint`, `test`.
6. Open a PR against `main`. CI must be green.

## Standards we enforce

- **Conventional Commits** at commit-msg time (`feat:`, `fix:`, `docs:`,
  `chore:`, etc.). The pre-commit hook will reject non-conforming
  messages. See https://www.conventionalcommits.org.
- **Signed commits**. Branch protection on `main` rejects unsigned
  commits.
- **CI green**: lint, type-check, tests must all pass.
- **One concern per PR**. Refactors and feature work are different PRs.

## What we look for in review

- Correctness, security, maintainability, tests. Style is the linter's
  job — don't comment on it.
- A PR description that explains *why*, not just *what*. The diff shows
  what; we want the reasoning.
- Self-review before requesting review. Open your own PR and read it as
  a stranger would.

## Reporting issues

For bugs and feature requests: use the issue templates in
[`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/).

For security issues: see [`SECURITY.md`](SECURITY.md). Do not file
public issues for vulnerabilities.

## Versioning

This project uses **SemVer** (Decision 5). For libraries,
that's SemVer. For applications, CalVer (`YYYY.M.D`). When you cut a
release, run `just release {patch|minor|major}` from `main` — CI takes
over from the tag push.

## License

By contributing, you agree your contributions will be licensed under the
project's existing license — see [`LICENSE-APACHE`](LICENSE-APACHE) and
[`LICENSE-MIT`](LICENSE-MIT) (or whichever single license this repo is
using; check the README).
