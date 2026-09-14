---
description: Add a new job-board SiteAdapter from pasted HTML (name, URL, list/pagination markup)
argument-hint: [portal name] [listing URL]
---

Add support for a new job board to this extension by writing a new
`SiteAdapter`, the same way `extension/src/adapters/linkedin.ts` and
`extension/src/adapters/welcometothejungle.ts` were built: **from HTML the
user pastes**, not from browsing the site yourself (you can't — there's no
live browser in this environment). Read `CLAUDE.md` first for the full
architecture ("Adapter pattern is the extension point for new job sites").

## 1. Gather what you need

Arguments passed to this command (if any): $ARGUMENTS — treat these as the
portal name and/or listing URL if provided, but still confirm them with the
user rather than assuming.

Ask the user directly in chat for whatever of this you don't already have:

1. **Portal name** and the **URL of the job-search/listing page** (not a
   single job's URL — needs to be the page that shows multiple results, so
   `matches(url)` and pagination can be derived from it).
2. **Raw HTML** of 2-3 job entries from that listing. Ask them to paste
   real markup (e.g. DevTools → select an element → "Copy outer HTML"), not
   a description — you need actual tags/attributes/classes to write
   selectors. Note explicitly: `WebFetch` converts pages to markdown and
   loses this, so it can't substitute for pasted HTML.
3. **HTML of the description/detail area** shown after opening one listing
   — ask whether it's a panel that appears without changing the URL (like
   LinkedIn), a real navigation to a new page, or already fully inline in
   the listing itself with no click needed.
4. **HTML of the pagination control** ("next page" button), or confirmation
   that it's infinite scroll / there is no next page (a single results
   page).
5. If reachable, ask what the **end-of-results state** looks like (does the
   next button disable, disappear, or does the site show some other
   "you've seen everything" screen?) — useful to have up front, but if the
   user doesn't know yet, don't block on it: write the adapter with the
   most defensible assumption (see step 3) and flag it as unverified,
   matching this project's own convention for placeholder selectors.

Do not proceed to writing code until you have at least items 1-3. Item 4/5
can be filled in with clearly-flagged placeholders if the user doesn't have
them handy yet.

## 2. Understand the page's structure before writing selectors

Not every job board is a LinkedIn-style list of simultaneously-visible
cards. Welcome to the Jungle, for example, is a "one job at a time" swipe
view with a single `next-button` — modeled as a page that always has
exactly one card (`countCardsExpr` is 0 or 1), with the "next" control
playing the role of `nextPageRectExpr`. Read
`extension/src/adapters/welcometothejungle.ts` for that pattern before
assuming a card-list shape; pick whichever model actually matches the
pasted HTML.

In the pasted HTML, prefer selectors in this order:
1. `id` attributes (most stable, if present).
2. `data-testid` / other semantic `data-*` attributes (very common in
   React/Vue apps and much more stable than generated classes).
3. Structural attributes with a stable naming convention (LinkedIn's
   `componentkey^="job-card-component-ref-"` is this kind).
4. Build-hashed classes (`sc-xxxx`, CSS-modules hashes, etc.) — last
   resort, and call this out explicitly as fragile in a comment.

Reuse `rectExprFor` from `extension/src/adapters/shared.ts` instead of
reimplementing it. If you find another genuinely site-agnostic helper worth
sharing while writing this adapter, add it to `shared.ts` too.

Watch for these specific traps already hit while building the existing
adapters:
- Never name a local variable `location` inside an evaluated expression —
  it shadows the global `window.location`, which you likely also need for
  `location.href` (the job URL). Use `locationText` or similar instead.
- If the click needed to open a detail panel might land on an `<a>` (e.g. a
  company link with `target="_blank"`), pick a different, inert click
  target for `cardRectExpr` — clicking a real link spawns a new tab.
- `workplaceType` extraction is optional per adapter — if there's no clear
  DOM signal (no parenthetical tag, no obvious keyword), just return
  `'unknown'` for it. The matching-service already asks the LLM to read
  workplace type from the posting text as a fallback whenever the DOM
  reports `'unknown'` (see `finalizeScore` in `background.ts` and
  `score.go`) — you get filtering for free without building anything extra.
- `jobId` needs to be stable enough for dedup. Prefer a real ID from the
  URL or a canonical link if one exists; only fall back to hashing
  title+company+location if nothing better is available, and say so in a
  comment (weaker dedup guarantee — document it like
  `welcometothejungle.ts` does).

## 3. Write the adapter

Create `extension/src/adapters/<slug>.ts` implementing the full
`SiteAdapter` interface (`extension/src/adapters/types.ts`):
`id`, `label`, `matches`, `timings`, `countCardsExpr`, `cardPreviewExpr`,
`cardRectExpr`, `scrollContainerRectExpr`, `detailReadyExpr`,
`extractExpr`, `nextPageRectExpr`. Start `timings` from LinkedIn's or
Welcome to the Jungle's values and only change them if the user tells you
this site is noticeably slower/faster to render.

Add a file-header comment stating what the HTML was calibrated from (date,
which page(s) were pasted) and what's confirmed vs. still a placeholder —
same tone as the existing two adapters' headers.

Register it in `extension/src/adapters/registry.ts` (one line, import +
push into the `adapters` array). Do not touch `background.ts` — if you find
yourself wanting to, stop and reconsider the adapter's design instead; the
existing loop is deliberately adapter-agnostic.

If the listing/search URL's host isn't already covered by an existing
`host_permissions` entry, add it to `extension/public/manifest.json`
(mirror the existing LinkedIn/Welcome to the Jungle entries exactly —
`"https://<host>/*"`).

## 4. Verify without a live browser

There's no real browser available here, so:
- Run `yarn typecheck` and `yarn build` in `extension/` — must pass clean.
- Manually trace `extractExpr`/`cardPreviewExpr`/`nextPageRectExpr` against
  the pasted HTML by hand (or, if Node's version in this environment
  supports it, a quick throwaway jsdom script) to confirm each selector
  actually resolves against the real sample and produces sensible values —
  don't just eyeball the code.
- Flag every assumption you couldn't verify (end-of-pagination behavior,
  workplace-type detection, salary formatting, etc.) inline as a comment,
  and add a short note to `CLAUDE.md`'s "Known placeholder / to calibrate"
  section, consistent with how LinkedIn's and Welcome to the Jungle's
  caveats are documented there. Update `README.md`'s roadmap checklist too
  if it lists adapters.

## 5. Commit

One commit for the new adapter (`feat(adapters): add <Portal Name> adapter`),
following this repo's existing commit style (see `git log`). Don't commit
unrelated changes. Ask the user to run `./scripts/start.sh` (or reload the
unpacked extension if it's already running) and report back anything that
came out empty or wrong on a real listing — the adapter is expected to need
a calibration pass, same as the others.
