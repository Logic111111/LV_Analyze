# Basic and Advanced modes

## Why

Less technical users build LV networks in Feeder Island too, but the full app (25 pages, about 15
settings cards on Setup, engineering tables) is too much for them. Basic gives them a smaller app
whose results they can read without training. Engineers keep everything in Advanced.

## Goals

- A Basic / Advanced switch. **Basic is the default.** Clicking Advanced switches to the full app
  at once; the choice is remembered in the browser (like the theme).
- Basic shows fewer pages and fewer Setup cards, and explains a run in plain language.
- Both modes use the same engine and the same design, so they give the same numbers.

## Non-goals

- A mode stored per account, or an admin forcing a mode on users.
- Different calculations, defaults or design data per mode.
- New translations beyond English (missing Sinhala/Tamil keys already fall back to English).

## Anti-goals

- Basic giving a different answer from Advanced for the same design.
- Basic breaking a link: "Suggest fix" in the Issues panel and any typed URL still open their page,
  even one hidden in Basic.

## Approaches

1. **Switch that hides pages and cards.** Smallest, but Basic users still face engineering tables.
2. **Switch plus a plain-language result** on Run & Reports. **Picked** (Claude's recommendation;
   the user did not object): it is what makes Basic results readable, and it reuses the violation
   list every run already returns.
3. **A separate Basic app** (like compare.html). Rejected: duplicates editing and saving, and moving
   a design to Advanced would mean switching apps.

## Design

- **Mode state.** A small context like `ThemeContext`: `mode` is `'basic' | 'advanced'`, stored in
  `localStorage` under `fi-mode`, default `'basic'` when nothing is stored or storage fails.
- **Switch.** In the top bar, a two-button segmented control "Basic | Advanced" (`aria-pressed`).
  Clicking either sets the mode immediately.
- **Pages in Basic (14):** New design wizard, Setup, Network, Map, Diagram, Run & Reports,
  24h Profile, Solar Hosting, Fix-it Ladder, Field survey, Dashboard, Designs, AI Insights, About.
  Hidden in Basic: Charts, Protection, Probabilistic, Scenarios, BESS Hosting, Feeder Split,
  Load Balance, Reconductor, Field data, OpenDSS Validation. Marked with a flag on each item in
  `lib/nav.js`; the sidebar and the command palette filter on it. Routes are not removed.
- **Wizard in the sidebar.** "New design wizard" moves from the palette-only list to the top of the
  Build group, in both modes (Claude's call: it is the natural Basic starting point and costs
  nothing in Advanced).
- **Setup in Basic:** transformer card(s) without the HV voltage profile and the tap advisor,
  Customer load assumptions, and Connection caps. Every other card is hidden.
- **Run & Reports in Basic:** after a run, a "What this means" card at the top, built by a pure,
  unit-tested function from `res.violations`:
  - no violations: "All customers are within limits at 20:00."
  - otherwise one line per kind, with the count, worst location and a link:
    voltage (under/over) to Fix-it Ladder, conductor overload to Reconductor, transformer overload
    to Feeder Split (these pages open by link even though Basic hides them from the sidebar).
  The OpenDSS cross-check card is hidden in Basic (the check itself is unchanged). The rest of the
  page stays as it is.
- **Switching to Basic on a page Basic hides:** stay on that page (Claude's call: nothing is lost,
  and the switch is one click away).
- **Existing users:** their first visit after release opens in Basic; one click on Advanced brings
  back the full app and is remembered.

```
 top bar:  [Design name]   [Search...]   ( Basic | Advanced )  undo redo theme lang account

 Run & Reports, Basic, after a run:
 +-------------------------------------------------------------+
 | What this means                                             |
 | 4 customers have low voltage at 20:00 (worst: P12).         |
 |   -> Try the Fix-it Ladder                                  |
 | Transformer TX1 is overloaded (112 %).                      |
 |   -> See Feeder Split                                       |
 +-------------------------------------------------------------+
```

## Left to the builder

- Exact wording of the plain-language lines and where the switch sits on phone widths.
- Whether to show the "What this means" card in Advanced as well (default: Basic only).
