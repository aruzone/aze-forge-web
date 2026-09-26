# AzeForge Web

AzeForge Web is the hosted authoring and rendering context for AzeMark documents.

## Language

**Description**:
A user’s natural-language request for an AzeMark document.
_Avoid_: Prompt

**AzeMark Source**:
The editable AzeMark document text, including a proposed draft before it is applied.
_Avoid_: AI result, generated artifact

**Draft Gate**:
The state in which proposed AzeMark Source has compiler analysis but awaits explicit user application to the editor.
_Avoid_: Auto-apply

**Optional TeX profile**:
A TeX technical-object profile that is available only when the current deployment advertises its renderer capability.
_Avoid_: Universal TeX support
