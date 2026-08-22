# Brain-dump

A personal app for capturing a thought the moment it occurs (voice or text), organizing it into a retrievable Note, and later answering questions over the accumulated Notes.

## Language

**Brain-dump**:
The act of capturing a thought in the moment, before it is organized.
_Avoid_: entry, log

**Dump**:
The raw record of a single brain-dump — a voice transcript or typed text, captured verbatim. During the capture session the user may add Context, which edits the Dump while preserving the verbatim original inside it. Once the Note is saved (or the session ends) the Dump is frozen and never changes again.
_Avoid_: raw note, transcript, entry

**Context**:
Detail the user adds to a Dump during the capture session, before the Note is saved. The verbatim original is preserved inside the Dump; the final Note is re-organized from the full Dump at save.
_Avoid_: addition, edit, note edit

**Note**:
The organized, editable artifact derived from one or more Dumps. The thing you browse, edit, and retrieve. A Note may be re-enriched but its source Dumps are never altered.
_Avoid_: document, file, entry

**Organize**:
The additive enrichment of a Dump into or onto a Note — a title, tags, summary, key points, related links, and category — without altering the source Dump. Related links are the only one of these with a legitimate empty value: a Dump may relate to nothing.
_Avoid_: process, format, clean up, rewrite

**Capture**:
Creating a Dump from a voice or text input.
_Avoid_: record, save, log

**Append**:
Adding a Dump's content to an existing Note, rather than founding a new Note. A Dump either founds a new Note or Appends to an existing one.
_Avoid_: merge, update, edit

**Retrieve**:
Answering a natural-language question by reading the relevant Notes and synthesizing an answer that cites them.
_Avoid_: search, query, lookup

**Modality**:
Whether an input is voice or text. Applies to both Capture and Retrieve.
_Avoid_: format, type, mode