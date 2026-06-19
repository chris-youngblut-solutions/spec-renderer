# Theme packs

spec-renderer's design system is an **interchangeable theme pack**, not a baked-in
palette. A *theme pack* is a CSS artifact that defines the `--cabin-*` token
vocabulary (day + night + font stacks). The engine's widget styles consume only
those tokens — never a literal color — so swapping one conforming pack for another
re-skins the whole single-file artifact with no other change.

Cabin is the **default** pack (`themes/cabin/`). It is the reference implementation
of the same `--cabin-*` contract the canonical panel-tiling
`design-system/cabin.css` ships; the contract — the token names — is the interface,
the values are per-pack.

## Selecting a pack

```sh
node scripts/compile-spec.mjs specs/survey.form.yaml -o out.html                 # default = Cabin
node scripts/compile-spec.mjs specs/survey.form.yaml --theme cabin -o out.html   # explicit (identical)
node scripts/compile-spec.mjs specs/survey.form.yaml --theme cool-slate -o out.html  # the alt pack
node scripts/compile-spec.mjs specs/survey.form.yaml --theme ./my-pack -o out.html   # a pack dir
node scripts/compile-spec.mjs specs/survey.form.yaml --theme ./my-pack/theme.css -o out.html  # a css file
node scripts/compile-spec.mjs --blank --theme cool-slate -o render.html          # the drop-in loader, alt theme
```

`--theme` accepts a **bare pack name** (a directory under `themes/`), a **pack
directory** (containing `theme.css`), or a **direct `.css` file** anywhere on disk.
The selected pack's tokens are inlined ahead of the engine's widget CSS, so the
output stays a single self-contained file.

## The contract

A conforming pack defines every token in `themes/tokens.json` (the Core
vocabulary), for both `:root, [data-cabin="day"]` and `[data-cabin="night"]`, plus
the three `--font-*` stacks. The full contract — token meanings, day/night rules,
metals — is `panel-tiling/design-system/THEME-PACK-CONTRACT.md`; `themes/tokens.json`
mirrors its machine-readable Core list.

Packs MUST stay offline / CSP-clean: **no `@import`, no embedded font files, no
remote `url()`**. The compiler enforces this — it rejects any pack that uses those
shapes (`loadThemeCss`), and the `offline-csp` + `theme-pack` tests pin it.

## Writing a new pack

1. Make a directory with a `theme.css`.
2. Define every Core token (day + night) and the font stacks. Easiest start: copy
   `themes/cabin/theme.css` and change the values.
3. Use system-font stacks only (no web fonts) to stay offline.
4. Compile with `--theme <your-dir>`; `tests/theme-pack.test.mjs` shows the
   conformance checks (and compiles an out-of-tree pack to prove the apparatus is
   not Cabin-bound).

## Bundled packs

| pack | palette |
|---|---|
| `cabin` (default) | warm paper / ink, terracotta accent |
| `cool-slate` | cool blue-grey, teal accent |

## Status

v1. Cabin is the default/reference pack; `cool-slate` proves swappability. The
`--cabin-*` token names are the frozen interface.
