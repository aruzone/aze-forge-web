# Authoring workspace redesign

Canonical implementation contract for parent issue #23. It assembles the closed decisions in [wayfinder #14](https://github.com/aruzone/aze-forge-web/issues/14). `CONTEXT.md` defines terminology. This document resolves UI behavior when a prototype differs from it.

Primary visual references are [workspace composition `19bc888`](https://github.com/aruzone/aze-forge-web/tree/19bc888) and [responsive workspace `d9e473d`](https://github.com/aruzone/aze-forge-web/tree/d9e473d). They establish hierarchy and density only. Production code must follow this specification.

![Annotated desktop, tablet, and reflow layouts](authoring-workspace-redesign/layouts.svg)

## Scope and glossary

One ephemeral **Current document** contains stable-identity **Cells**. A Cell is an author-chosen partition of assembled **AzeMark Source**. It may contain Markdown, directives, or both. A **Description** is natural-language input for generation. **Last-applied Source**, **Pending Description**, and **Draft Gate** retain their meanings from [`CONTEXT.md`](../../CONTEXT.md).

The release has no projects, persistence controls, multi-document interface, per-Cell execution, accounts beyond an applicable session action, or changed compiler/service protocol. The document-collection boundary is internal only. It permits a later multi-document product without showing false affordances now.

Desktop means at least 1200 CSS px. Tablet means 768 through 1199 CSS px. Product features below 768 are unsupported. Existing essential workflows must reflow to 320 CSS px without workspace-level two-dimensional scrolling.

## Information architecture and annotated layouts

Reading and DOM order is fixed: skip links; application navigation; Current document navigation; utility bar; Document preview; Document details; Cell canvas; contextual diagnostics or service surfaces. CSS never changes that sequence.

### Desktop, at least 1200 CSS px

The Structured canvas has a 64 px dark application rail, a 248 px light Current document sidebar, and a light editing workspace. The 56 px utility bar spans the workspace. A full-width Document preview starts at 28% of available workspace height. Document details follow. The Cell canvas is one vertical column, inset 24 px and capped at 920 px. The desktop base layout is annotated in `layouts.svg`.

### Tablet, 768 through 1199 CSS px

Keep a 56 px application rail. Remove the sidebar from normal layout and expose its complete 272 px Current document drawer from the first utility-bar control. The 52 px utility bar keeps document trigger first and compact Theme, diagnostics, Export, and More controls last. The preview stays above Document details and the one-column Cell canvas. It starts at 30% of available height. The canvas inset is 16 px. The tablet base and open-drawer state are annotated in `layouts.svg`.

### Accessibility reflow, 320 CSS px

Stack the utility actions, preview controls, Document details, and Cell controls into one column or wrapping rows. The Current document remains a modal drawer. The diagnostics view remains a sheet. Source and rendered content may scroll locally when their content requires two dimensions. No workspace container may require horizontal scrolling. The reflow diagram in `layouts.svg` is an accessibility requirement, not a supported small-screen product layout.

### Geometry-changing overlays

`layouts.svg` annotates these targeted states. They supplement the base layouts and do not create independent routes.

| State | Required visible treatment | Owner |
| --- | --- | --- |
| Description editing | `Source` and `Describe with AI` tabs over the same editor, preserved Description, explicit AI action | owning Cell |
| Generating | invoking action becomes `Cancel generation`; Source-changing controls are disabled or inert | owning Cell and document mutation lock |
| Draft Gate | comparison with Last-applied Source, validity, compiler diagnostics, Apply and Discard | owning Cell |
| Document diagnostics | desktop right dock or tablet bottom sheet, grouped by severity then Source order | diagnostics summary |
| Preview stale/loading/failed | persistent amber state, loading treatment over retained Artifact, recovery action and diagnostics link when blocked | Document preview |
| Expanded preview | viewport modal with shared preview state and toolbar | Expand control |
| Export progress/failure | state stays with selected Export menu item; failure links diagnostics where applicable | Export menu |
| Service degradation | persistent rail health indicator; details on activation | application rail |
| Empty/search | `Preview not generated`, empty Cell and `No matching cells` states | preview, Cell canvas, navigation |

## Tokens

| Token | Value and use |
| --- | --- |
| `color-nav`, `color-nav-raised` | `#111827`, `#202b3c`, application rail and raised dark surfaces |
| `color-canvas`, `color-surface`, `color-border` | `#eef1f5`, `#ffffff`, `#d7dee8`, editing background, panels, rules |
| `color-text`, `color-muted` | `#162033`, `#68758a`, primary and secondary text |
| `color-accent`, `color-accent-surface` | `#2563eb`, `#eaf1ff`, selected state, links, focus base |
| `color-success`, `color-stale`, `color-error` | `#16825b`, `#c76b13`, `#b42318`, semantic states with text labels independent of color |
| `font-ui`, `font-source` | system sans-serif `14px/1.4`; system monospace `12px/1.55` desktop and `11px/1.55` tablet |
| `space-1` through `space-6` | 4, 8, 12, 16, 24, 32 px |
| `radius-control`, `radius-panel` | 6 px, 8 px |
| `border-default` | 1 px `color-border` |
| `focus-ring` | 2 px `color-accent` outline, 2 px separation, at least 3:1 adjacent contrast |
| `cell-focus` | 1 px `#8eb0ed` border plus 2 px `#dce8ff` outer emphasis |
| `shadow-overlay` | `8px 0 30px #0e182a33`; ordinary Cells have no shadow |
| `layer-base`, `layer-sticky`, `layer-scrim`, `layer-panel`, `layer-modal`, `layer-announcement` | 0, 10, 20, 30, 40, 50 |
| `motion-overlay` | drawer, sheet, modal, resize, scroll and stale transitions use 160 ms ease; zero duration under reduced motion |
| `rail-desktop`, `sidebar-desktop`, `utility-desktop` | 64 px, 248 px, 56 px |
| `rail-tablet`, `drawer-tablet`, `utility-tablet` | 56 px, 272 px, 52 px |

Text meets 4.5:1 contrast at normal sizes. Large text, meaningful graphics, and focus indicators meet 3:1. Forced-colors uses system colors while retaining borders, focus, selected, disabled, success, stale, warning, and error meaning.

## Component contracts

### Application rail

**Purpose and anatomy.** Application-level navigation: AzeForge brand, one roving `Author` destination, compact service health, and an applicable session action such as Sign out. It owns none of diagnostics, export, Theme, analysis, formatting, or Cell actions.

**States and actions.** `Author` is selected. Health is healthy, degraded, or requiring user action. Activating health opens progressively disclosed connectivity and capability details. No Assets, Projects, Settings, disabled destinations, or empty destinations exist.

**Focus, keyboard, announcements, responsive.** It is a labelled navigation landmark with one roving Tab stop. Arrow keys move rail items. Service degradation persists and is announced only on meaningful change. The rail narrows to 56 px on tablet. Related IDs: NAV-01, A11Y-01, SERVICE-01.

### Current document navigation

**Purpose and anatomy.** A labelled navigation landmark headed `Current document`, one static document row, Find in document, Cell outline, and Add Cell. The row shows title or `Untitled document`, `This session`, and Cell count. It has no chevron, New, Open, Recent, Duplicate, project language, persistence control, or overflow menu.

**Inputs and states.** The outline receives stable identity, ordinal, derived label, and content-kind summary. Derive label from first meaningful Source line: heading, prose, directive name, then `Untitled cell`. Summarize as Markdown, Directive, or Markdown + directive, naming a dominant directive only when useful. Identity never derives from label or ordinal. The active entry follows editor focus, otherwise the first substantially visible Cell.

**Actions and rules.** Clicking the document row scrolls to, expands, and focuses Document details. Clicking an outline item scrolls before focusing its Cell. Search indexes labels, Source, and Pending Description but filters only the outline. It exposes whether a match is Source or Pending Description. Up and Down move matches. Enter focuses the selected Cell. Escape clears the query and returns focus to search. Empty result shows `No matching cells`. Find in document lives only here; the utility bar and the editor never duplicate it.

**Focus, keyboard, responsive.** The outline has one roving Tab stop. Arrows move items; Enter activates. On desktop it is persistent. On tablet it is a modal dialog opened by the utility-bar document trigger. The drawer focuses Find in document when opened for search, otherwise its heading; it traps focus, makes the workspace inert, closes by Close, scrim, or Escape, and restores the trigger. Related IDs: NAV-01 through NAV-03, CELL-01, A11Y-01, A11Y-02.

### Cell canvas and editor

**Purpose and anatomy.** One vertical Cell list follows Document details. Each Cell contains a heading, local drag handle, compact overflow, Source and Describe with AI tabs over one editor panel, and contextual generation or Draft Gate content. Always show the drag handle and overflow. Reveal Move up, Move down, Add before, Add after, and Delete on focus or hover. Boundary-invalid moves are disabled. Insertion controls appear between Cells and after the last Cell. Dragging is optional and never the only reorder path.

**Data and transitions.** A Cell stores Last-applied Source and Pending Description. Switching to Description preserves Last-applied Source and shows Pending Description, blank when none exists yet. Back to Source restores Last-applied Source. Direct Source edits update Last-applied Source. AI submits only explicit non-empty Description; visible Source is never implicitly treated as a Description. Description stays pending until explicitly cleared or the Cell is deleted. Front matter belongs only to Document details. Strip a front-matter block from pasted Cell Source and applied AI Source without changing Document details.

**Mutation, focus, keyboard, announcements.** Insert focuses the new Cell editor. Move preserves focus in the moved Cell and announces ordinal. Delete focuses following Cell, then preceding Cell, then Add Cell; it exposes temporary Undo. Undo restores complete Cell state, position, stable identity, and focuses its heading. Delete never asks for confirmation while that complete recovery exists. The two-tab list is labelled `Cell editor mode`; Left and Right move tab focus and Enter or Space activates. Arrowing never changes content or enters the editor. Related IDs: CELL-01 through CELL-03, DRAFT-01 through DRAFT-04, A11Y-02.

### Generation and Draft Gate

**Purpose and ownership.** The document owns at most one generation or Draft Gate. The owning Cell presents it beside the editor. A request captures owner Cell identity, Description snapshot, document revision, and request generation.

**States and disabled rules.** Description editing permits AI only for non-empty Description and no document proposal. Generating locks every Source-changing and structural action, while navigation, preview inspection, and non-mutating actions remain available. The invoker becomes `Cancel generation`. A current response yields Clarification, Refusal, recoverable failure, or a valid, invalid, or stale Draft Gate. Clarification offers Revise Description. Refusal offers Dismiss. Failure names network, provider, timeout, or compiler-analysis infrastructure failure and offers Return to Description. None is a Draft Gate and none retries automatically.

**Draft Gate and focus.** It compares proposal with Last-applied Source and shows compiler severity, code, and message beside proposed Source. A polite arrival exposes `Review proposed Source` beside the owning Cell; that action focuses the Draft Gate heading or comparison. Apply is enabled only for a valid proposal at its captured revision. Apply atomically updates Last-applied Source, retains Pending Description, analyzes normally, marks preview stale, closes the gate, and focuses the start of applied Source. Discard preserves Last-applied Source and Pending Description, closes the gate, and focuses Description. Arrival never steals focus. Invalid or stale Apply keeps focus and exposes its reason with `aria-describedby`. Ordinary editor undo may restore Source after Apply; the Draft Gate is never retained as an undo mechanism.

**Cancellation and stale response rules.** Cancellation increments request generation before unlocking, attempts transport cancellation when possible, returns to Description, and ignores every later response. Source edit, insert, delete, or reorder changes document revision and never requires confirmation first. A surviving proposal remains visible but becomes permanently stale, disables Apply, and permits Discard or explicit regeneration. Deleting its owner removes the proposal. Late, cancelled, superseded, ownerless, and stale responses never open a gate. Related IDs: DRAFT-01 through DRAFT-04, A11Y-02.

### Document preview

**Purpose and anatomy.** One manually refreshed Document preview has shared state in inline and expanded presentations: status, Artifact, request identity, revision, Theme, height, and failure. It begins `Preview not generated` with `Refresh preview`. No load, edit, Theme change, or expansion compiles automatically.

**States and actions.** Refresh captures revision and Theme. While refreshing, disable the action as `Refreshing…`; retain existing Artifact visibly but non-interactively under a subtle loading treatment. Without an Artifact, use a loading empty state. Exact revision and Theme success replaces shared Artifact and marks it current. Source or Theme changes retain Artifact as amber `Out of date`. No edit count is shown. Invalid Source shows `Preview blocked by Source errors` and `View diagnostics`, retaining prior Artifact as stale. Network, timeout, compiler infrastructure, Artifact-fetch, and iframe-load failure persist inline, restore Refresh, retain prior Artifact, and never retry. Iframe-load failure revokes its unusable object URL.

**Sizing, modal, focus, keyboard, responsive.** Desktop starts at 28%, clamps from 180 px to 60% of available workspace height. Tablet starts at 30%, clamps from 160 px to 50%. Session storage persists height only. The divider is a horizontal separator whose accessible current value, minimum, and maximum are the computed pixel height and applicable bounds. Pointer and separator keyboard behavior share one clamp: Arrow 16 px, Shift+Arrow 64 px, Home minimum, End maximum, Enter and double-click reset. Expand is enabled only with a loaded Artifact. It opens a viewport modal with the same Artifact and state. Its toolbar mirrors preview status and `Refresh preview`, starts focus on heading or toolbar rather than iframe, traps focus, closes on Escape, and restores the exact Expand trigger. The loaded iframe is one Tab stop with a stateful title. Adjacent Enter preview and Return to preview controls exist if rendered content cannot guarantee an exit. A polite region announces meaningful preview changes only. Related IDs: PREVIEW-01 through PREVIEW-05, A11Y-01, A11Y-02.

### Utility bar

**Purpose, anatomy, and inputs.** The 56 px desktop and 52 px tablet bar receives Current document identity, Theme, diagnostics state, export capabilities, and operation state. Desktop places the Current document identity at left, with Theme, diagnostics summary, Export, and More at right. Tablet replaces the identity with the first-position Current document drawer trigger. More contains Analyze and Format.

**States, actions, disabled rules, and failures.** Theme is enabled and marks preview stale. Analyze and Format show progress on their initiating item and are disabled only while their own operation runs. Export shows enabled capability-supported formats and disabled unsupported formats with reasons. No action is duplicated in the rail. Failure remains on the relevant menu item or opens diagnostics, never as a toast-only result.

**Focus, keyboard, announcements, responsive.** Each control is a native button or menu button in reading order. Menus focus the first appropriate item on open; arrows, Home, End, Enter, and Space operate them; Escape restores the exact trigger. Successful analysis, formatting, and export announce politely. Related IDs: DOC-01, DOC-02, FORMAT-01, EXPORT-01, EXPORT-02, A11Y-01, A11Y-02.

### Document details

**Purpose, anatomy, and inputs.** A collapsible named section below preview owns title, authors, date, and additional metadata. It receives Current document front matter and authoritative metadata diagnostics.

**States, actions, disabled rules, and failures.** It is expanded for empty or invalid metadata and collapses by default after meaningful metadata exists. The Current document row expands it. Metadata diagnostics auto-expand it. Invalid fields expose local programmatic invalid state, concise described feedback, and the matching diagnostics entry; they do not block unrelated navigation.

**Focus, keyboard, announcements, responsive.** A standard disclosure controls the section. Exact diagnostic activation focuses the metadata field or Source range. The section remains above Cells at every width. Related IDs: DOC-01, A11Y-01, A11Y-02.

### Document diagnostics

**Purpose, anatomy, and inputs.** The persistent summary receives analysis status and counts. The authoritative details surface receives diagnostics with severity, Cell label, Source range, and source order.

**States, actions, disabled rules, and failures.** Summary states are Valid, warning count, error count, analyzing, and failure. Details show `No diagnostics` after valid analysis. Inline Source markers may supplement this surface but never replace it. It is a resizable desktop right dock or tablet bottom sheet, persists open state for the tab session, and keeps focused ranges unobscured.

**Focus, keyboard, announcements, responsive.** It is a non-modal complementary region. Open focuses its heading; Tab may leave; Escape while focus is inside closes and restores the summary trigger. Selecting an entry keeps it open and focuses the exact Source range. Analysis completion announces politely. Related IDs: DOC-01, DOC-02, A11Y-01, A11Y-02.

### Format

**Purpose, anatomy, and inputs.** Format receives assembled Current document Source at one revision and presents a document-wide `Formatted Source` comparison with Apply and Discard. It has no Description and is never AI-labelled.

**States, actions, disabled rules, and failures.** Starting Format marks its More item in progress. Exact-revision success opens review. Stale results are ignored. Apply is disabled for stale review and is the only mutation path. Failure stays with Format and offers recovery without automatic retry.

**Focus, keyboard, announcements, responsive.** Review uses the same comparison focus pattern as Draft Gate. Apply returns focus to its Source target; Discard returns to the invoking control. Successful formatting announces politely. It remains a contextual surface at every width. Related IDs: FORMAT-01, A11Y-02.

### Export

**Purpose, anatomy, and inputs.** Export is one utility-bar menu receiving capabilities, current Source, Theme, validation status, and chosen format. It offers HTML, SVG, PNG, and PDF only when capabilities support them.

**States, actions, disabled rules, and failures.** Unsupported formats remain disabled with a reason. Choosing a supported format compiles current Source and Theme independently of preview freshness. The chosen item shows progress and completion or failure. Invalid Source blocks download, opens diagnostics, and never exports stale Artifact bytes.

**Focus, keyboard, announcements, responsive.** Its menu follows the utility-bar menu pattern. Completion and actionable failure announce politely. Progress and failure stay associated with the chosen action. Related IDs: EXPORT-01, EXPORT-02, A11Y-01, A11Y-02.

## State, transition, and stale-response contract

**Invariants:** Document revision increments for every Source or structural mutation. Only one generation or Draft Gate exists. Only exact request identity, revision, and Theme can mutate their respective result state. Proposal and preview responses never queue. Artifact is not persisted. All routine results use one polite workspace live region. Assertive alerts are only for failures requiring immediate action.

| State | Event and guard | Side effects | Next state and visible result | Focus result | Stale-response rule |
| --- | --- | --- | --- | --- | --- |
| Source editing | edit, no generation lock | revision increments; Last-applied Source updates | Source editing; preview and proposal stale | editor remains focused | n/a |
| Description editing | explicit AI, non-empty Description, no proposal | save Pending Description; capture owner, request, revision; lock mutation | Generating; Cancel generation visible | invoker remains focused | later request generations ignored |
| Generating | current clarification response, owner exists | retain Pending Description; unlock mutation | Clarification response panel with Revise Description | focus remains invoking Cancel control | cancelled, superseded, or ownerless response ignored |
| Generating | current refusal response, owner exists | retain Pending Description; unlock mutation | Refusal response panel with Dismiss | focus remains invoking Cancel control | cancelled, superseded, or ownerless response ignored |
| Generating | current recoverable failure, owner exists | retain Pending Description; unlock mutation | named network, provider, timeout, or compiler-analysis failure with Return to Description | focus remains invoking Cancel control | cancelled, superseded, or ownerless response ignored |
| Generating | current proposed Source response, owner exists | analyze proposal | valid, invalid, or stale Draft Gate | no focus steal; Review proposed Source targets gate heading | cancelled, superseded, ownerless, or stale response ignored |
| Generating | Cancel | increment request generation; attempt transport cancel; unlock | Description editing | Description editor | all cancellation-late responses ignored |
| Draft Gate valid | Apply, captured revision matches | atomic Source update; analyze; preview stale | Source editing | applied Source start | stale or invalid Apply cannot mutate |
| Draft Gate any | Discard | remove proposal analysis; unlock | Description editing | Description editor | discarded response cannot revive |
| Draft Gate any | Source or structural mutation | revision increments; preserve proposal for inspection | Draft Gate stale | mutation target stays focused | proposal never becomes valid again |
| Preview current or stale | Refresh | capture request, revision, Theme | Refreshing | no focus movement | changed revision or Theme makes request obsolete |
| Refreshing | exact success | replace shared Artifact | Preview current | no focus movement | request, revision, or Theme mismatch ignored |
| Refreshing | exact failure | retain Artifact stale; revoke bad URL if applicable | Preview failure | no focus movement | obsolete failure ignored |
| Any preview | Theme change | mark existing Artifact stale | Preview stale | no focus movement | no automatic refresh |
| Analyze or Format | exact revision result | update diagnostics or review proposal | Diagnostics current or format review | initiating surface retains focus | revision mismatch ignored |

## Keyboard, focus, and accessibility

WCAG 2.2 AA applies to desktop, tablet, and 320 px reflow. Skip links are `Skip to editor`, `Skip to Document preview`, and `Skip to Current document navigation`, omitting unavailable targets. Use labelled application and Current document navigation landmarks, one `main`, named sections, complementary diagnostics, and dialogs only for modal surfaces. Native controls are preferred. Positive `tabindex` is forbidden. Static status and Cell containers are not permanent Tab stops. Programmatic targets use `tabindex=-1` only when required.

Every desktop interaction box is at least 32 by 32 px and every tablet box at least 44 by 44 px. All meet the 24 by 24 px WCAG minimum unless a documented exception applies. Visible focus is unclipped. Menus and popovers focus the first appropriate item when opened, use arrows, Home, End, Enter, Space, and Escape, and restore their exact trigger on Escape. Escape closes only the innermost disclosure or modal. Outside pointer close does not steal subsequent pointer focus. Nested menus are excluded.

Essential behavior never depends on shortcuts. Unmodified global character shortcuts are forbidden. `Mod+K` for Find in document is optional only when it avoids host conflicts and is discoverable plus disableable or remappable.

One polite live region coalesces generation, cancellation, preview, analysis, formatting, Cell movement, Undo, and export outcomes. Visible text carries status independently of color. Background analysis and Draft Gate arrival never take focus. Reduced motion removes transition and scrolling animation. Progress always has text and never relies on motion.

## Deterministic fixtures

| Fixture | Exact content and purpose |
| --- | --- |
| Minimum | Current document title is empty. It has `cell-01` only, with empty Source and Pending Description. Preview status is `Preview not generated`. |
| Typical | Title `Document basics`; authors `AzeForge examples`; date `2026-09-28`; Theme `default`. `cell-01`: `# Thermal balance<br><br>Heat leaves the vessel through the wall.`. `cell-02`: `:::: equation<br>E = mc^2<br>::::`. `cell-03`: `:::: callout<br>The table uses SI units.<br>::::<br><br>Read each column before comparing values.`, with Pending Description `Explain the table in plain language.`. `cell-04`: `| Symbol | Value |<br>| --- | --- |<br>| α | 0.5 |<br>| β | 1.0 |`. |
| Stress | Title is `Stress document with a deliberately long metadata title for truncation verification`; authors are `Ada Example; Babbage Example; Curie Example`; date is `2026-09-28`; additional metadata key `description` is `d` repeated 512 times. Cells have identities `cell-01` through `cell-30`, in that order. For `n` 01 through 30, Source is `# Duplicate label` for 01 and 02; `# This is the deterministic long derived label for cell 03 used to verify clipping without changing identity` for 03; `:::: callout<br>Cell n<br>::::` for 04 through 10; `:::: equation<br>n + n = 2n<br>::::` for 11 through 20; `Markdown body for cell n.` for 21 through 29; and `x` repeated 102400 times for 30. Replace `n` with the two-digit cell number. `cell-25` Source is empty. `cell-26` appends `a` repeated 4096 times. `cell-27` appends `Unicode: α β γ 日本語 🚀`. `cell-28` Pending Description is `Explain ` plus `p` repeated 2048 times. `cell-29` appends `:::: directive<br>mixed<br>::::`. Diagnostics are exactly 40 records, `diag-01` through `diag-40`: 01–16 errors, 17–32 warnings, 33–40 information; each points to `cell-` plus the two-digit value of `((index - 1) mod 30) + 1`, range line 1 column 1, code `fixture.<severity>.<two-digit index>`, and message `Deterministic <severity> diagnostic <two-digit index>`. |

## Acceptance criteria

| ID | Given / When / Then | Evidence |
| --- | --- | --- |
| NAV-01 | Given one Current document, when navigation renders, then it shows only the static document row, search, outline, Add Cell, and rail actions permitted here. | DOM and desktop/tablet captures |
| NAV-02 | Given duplicate labels and reordered Cells, when navigation targets a Cell, then stable identity selects the intended Cell. | state test and keyboard walkthrough |
| NAV-03 | Given a Source or Pending Description query, when searching, then only the outline filters and the match origin is exposed. | browser walkthrough |
| CELL-01 | Given insert, move, delete, and Undo, when invoked by keyboard, then focus and full state follow this contract. | state test and walkthrough |
| CELL-02 | Given pasted or applied Cell Source with front matter, when it is accepted, then the Cell retains only body and Document details stays unchanged. | unit test and browser scenario |
| CELL-03 | Given Cell source kinds and boundaries, when labels and controls render, then labels, summaries, and disabled moves follow the contract. | browser scenario |
| DRAFT-01 | Given explicit Description, when generation starts or cancels, then mutation locks, focus, and late-result handling follow this contract. | state test and browser scenario |
| DRAFT-02 | Given valid, invalid, and stale proposals, when Apply is considered, then only exact-revision valid Source applies. | state test |
| DRAFT-03 | Given Apply or Discard, then Last-applied Source and Pending Description follow the contract. | state test |
| DRAFT-04 | Given clarification, refusal, failure, deleted owner, or superseded response, then no unintended Draft Gate opens and recovery is explicit. | state test and browser scenario |
| PREVIEW-01 | Given load, edit, Theme change, or expansion, when none is Refresh, then no compilation occurs. | request-log walkthrough |
| PREVIEW-02 | Given current and obsolete responses, when they settle, then only exact revision and Theme replace Artifact. | state test |
| PREVIEW-03 | Given failure with a previous Artifact, then it stays visible and stale with recovery. | browser scenario |
| PREVIEW-04 | Given pointer or separator input, when resizing, then clamp, reset, and session-only height persistence match the contract. | browser walkthrough |
| PREVIEW-05 | Given a loaded Artifact, when expanded, then inline and dialog state stay shared and dialog focus restores exactly. | browser walkthrough |
| DOC-01 | Given metadata diagnostics, when diagnostics arrive, then Document details expands and exact activation focuses its field. | browser scenario |
| DOC-02 | Given diagnostics dock or sheet, when opened and navigated, then it remains non-modal, grouped, and preserves range visibility. | browser walkthrough |
| FORMAT-01 | Given a format result, when reviewed, then Source changes only after Apply and never gains AI labelling. | browser scenario |
| EXPORT-01 | Given stale preview and valid Source, when export runs, then it compiles current Source and Theme, not preview bytes. | service request evidence |
| EXPORT-02 | Given unsupported format or invalid Source, when Export opens, then reason or diagnostics recovery is visible. | browser scenario |
| SERVICE-01 | Given degraded service or required user action, when health changes, then rail state persists and details are available. | browser scenario |
| A11Y-01 | Given desktop, tablet, and 320 px reflow, when inspected, then order, landmarks, contrast, focus, reflow, motion, and forced colors meet this contract. | automated scan and manual checks |
| A11Y-02 | Given each essential workflow, when completed keyboard-only, then focus never disappears or traps unintentionally. | Chromium and Safari walkthrough |

## Verification matrix and traceability

Capture 1440x900, 1200x900, 1199x900, 1024x768, 768x1024, 767x1024 reflow, and 320x800 reflow. Run minimum, typical, and stress fixtures. Collect browser captures, request and state walkthroughs, automated accessibility scans, keyboard checks in Chromium and Safari, VoiceOver with Safari, and NVDA on Windows where available. An unavailable platform is an explicit gap, never a pass.

| Closed decision | Specification sections | Acceptance IDs | Required evidence |
| --- | --- | --- | --- |
| [#15](https://github.com/aruzone/aze-forge-web/issues/15) cell state model | Cell canvas; Generation and Draft Gate; state contract | CELL-01, DRAFT-01 through DRAFT-04, A11Y-02 | reducer tests and generation walkthrough |
| [#16](https://github.com/aruzone/aze-forge-web/issues/16) specification contract | all sections | all IDs | traceability review and viewport captures |
| [#17](https://github.com/aruzone/aze-forge-web/issues/17) composition | IA; layouts; tokens | NAV-01, A11Y-01 | desktop captures against Structured canvas |
| [#18](https://github.com/aruzone/aze-forge-web/issues/18) navigation | Current document navigation | NAV-01 through NAV-03, CELL-01 | keyboard, search, and stress walkthrough |
| [#19](https://github.com/aruzone/aze-forge-web/issues/19) controls | utility, details, diagnostics, format, export | CELL-01, DOC-01, DOC-02, FORMAT-01, EXPORT-01, EXPORT-02, SERVICE-01 | operation walkthroughs |
| [#20](https://github.com/aruzone/aze-forge-web/issues/20) preview | Document preview; state contract | PREVIEW-01 through PREVIEW-05 | stale, failure, resize, and modal scenarios |
| [#21](https://github.com/aruzone/aze-forge-web/issues/21) responsive measurements | layouts; tokens | NAV-01, PREVIEW-04, A11Y-01 | breakpoint captures |
| [#22](https://github.com/aruzone/aze-forge-web/issues/22) accessibility | keyboard, focus, and accessibility | A11Y-01, A11Y-02 and component IDs above | scans, manual focus, keyboard, and assistive-technology evidence |

The traceability table covers every closed child listed by wayfinder #14. Later implementation issues cite these IDs instead of restating decisions.
