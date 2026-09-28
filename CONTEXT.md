# AzeForge Web

AzeForge Web is the hosted authoring and rendering context for AzeMark documents.

## Language

**Current document**:
The sole AzeMark document being authored in the present ephemeral session.
_Avoid_: Project, saved document

**Cell**:
An author-chosen partition of the Current document that may contain Markdown, directives, or both.
_Avoid_: Executable cell, document

**Document preview**:
The single manually refreshed rendering of the Current document, which remains visibly out of date after Source or Theme changes until a matching refresh succeeds.
_Avoid_: Cell output, live preview, rendered output

**Document diagnostics**:
The authoritative compiler feedback for the assembled AzeMark Source of the Current document.
_Avoid_: Cell output, preview error

**Description**:
A user’s natural-language request for an AzeMark document.
_Avoid_: Prompt

**AzeMark Source**:
The editable AzeMark document text, including a proposed draft before it is applied.
_Avoid_: AI result, generated artifact

**Last-applied Source**:
The accepted AzeMark Source for a cell that currently contributes to the assembled document and is restored when the author leaves Description editing without applying a proposal.
_Avoid_: Previous Source, original Source

**Pending Description**:
The preserved Description associated with a cell while generation, review, retry, or direct Source editing continues.
_Avoid_: Prompt history

**Draft Gate**:
The state in which proposed AzeMark Source has compiler analysis but awaits explicit user application to the editor.
_Avoid_: Auto-apply

**Optional TeX profile**:
A TeX technical-object profile that is available only when the current deployment advertises its renderer capability.
_Avoid_: Universal TeX support
