# Domain docs

## Before exploring, read these

- `CONTEXT.md` at the repo root, or
- `CONTEXT-MAP.md` at the repo root if it exists. It points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- `docs/adr/`. Read ADRs that touch the area being changed. In multi-context repos, also check `src/<context>/docs/adr/`.

If any are absent, proceed silently. `/domain-modeling` creates them only when terms or decisions are resolved.

## File structure

This is a single-context repository: root `CONTEXT.md`, root `docs/adr/`, and `src/`.

## Use the glossary's vocabulary

Use terms from `CONTEXT.md` in issue titles, refactor proposals, hypotheses, and test names. If a needed concept is absent, either reconsider the term or record the gap for `/domain-modeling`.

## Flag ADR conflicts

Explicitly identify any conflict with an existing ADR rather than silently overriding it.
