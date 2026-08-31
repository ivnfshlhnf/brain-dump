# Brain-dump

A personal app for capturing a thought the moment it occurs (voice or text), organizing it into a retrievable Note, and later answering questions over the accumulated Notes.

## Language

**Brain-dump**:
The act of capturing a thought in the moment, before it is organized.
_Avoid_: entry, log

**Dump**:
The raw record of a brain-dump — a voice transcript or typed text, captured verbatim. During the capture session the user may add Context, which edits the Dump while preserving the verbatim original inside it. An Append merges the new capture into the target Note's Dump as a dated section, so a Note has exactly one Dump and that Dump accumulates the Note's whole history, every capture verbatim inside it. A founding Dump is frozen once its Note is saved; a Dump only ever grows by an Append. Every founding Dump is in exactly one of four states — filed into a Note, Pending, Stranded, or Dismissed.
_Avoid_: raw note, transcript, entry

**Context**:
Detail the user adds to a Dump during the capture session, before the Note is saved. The verbatim original is preserved inside the Dump. The final Note is organized from the full Dump (original plus Context); when Context was added it is re-organized at save, and when no Context was added the preview the user approved already is that Organize and is reused as-is.
_Avoid_: addition, edit, note edit

**Note**:
The organized artifact derived from exactly one Dump. The Dump is the record; the Note is a view of it. The thing you browse and retrieve — but an edit made directly to a Note is provisional: it lasts until the next Organize, which regenerates the Note from the Dump. Anything worth keeping belongs in the Dump. A Dump is never rewritten, only grown by an Append.
_Avoid_: document, file, entry, source of truth

**Organize**:
The rendering of a Dump into a Note — a title, tags, summary, key points, category, and body — without altering the source Dump. Every part of this is derived from the Dump alone. On an Append the Note is re-organized wholesale from the accumulated Dump: body and title alike are rewritten, not patched.
_Avoid_: process, format, clean up, additive enrichment

**Category**:
The single coarse subject a Note belongs to, drawn from a fixed set the app defines. Every Note has exactly one; a Note the Organize could not place takes `uncategorized`, which is an ordinary member and not a failure.
_Avoid_: type, kind, folder

**Tag**:
A fine-grained keyword Organize derives from a Dump. A Note has many, drawn from no fixed set — the open counterpart to the one closed Category.
_Avoid_: label, keyword, topic

**Capture**:
Creating a Dump from a voice or text input.
_Avoid_: record, save, log

**Pending**:
A Dump that has been Captured but whose Note does not exist yet. A Dump is Pending from the moment it is written until the Note it produces is written — whether the Organize is in flight, waiting on a connection, or waiting on a retry. Every Dump is Pending for a moment; being Pending is ordinary and says nothing is wrong.
_Avoid_: queued, outbox, in progress, unprocessed

**Stranded**:
A Pending Dump the app has stopped working on — the Organize failed repeatedly, or an interruption ended the session that would have finished it. Stranded is the app admitting it took a thought and did not file it, so it is always surfaced and never silent. The thought itself is safe in the Vault; what is missing is the Note, and it will not appear without a retry.
_Avoid_: orphaned, lost, failed, abandoned

**Dismissed**:
A Stranded Dump the user has decided not to file. Dismissing is a note to self and nothing more: the Dump stays exactly where it is in the Vault, unchanged and still readable. It means "stop telling me about this", never "destroy this thought" — removing a thought is something only the user does, in their own editor. Only a Stranded Dump can be Dismissed: a sheet the user shuts is *closed*, and a message they wave away is *cleared*.
_Avoid_: ignored, archived, deleted, skipped

**Append**:
Adding a capture to an existing Note rather than founding a new Note. Appending merges the capture into the target Note's one Dump as a dated section, then re-organizes the Note wholesale from the accumulated Dump. A Dump either founds a new Note or Appends to an existing one.
_Avoid_: merge, update, edit, section insert

**Related**:
A connection between two Notes that is real but not strong enough to Append — the two stay separate documents. Any genuine connection counts; Append is the stronger case, where the connection warrants merging the content into one Note. Related links are recomputed on every Organize and point only at Notes that exist — a link to a Note that does not exist is not a Related link but an error.
_Avoid_: similar, linked, see also

**Retrieve**:
Answering a natural-language question by reading the relevant Notes and synthesizing an answer that cites them.
_Avoid_: search, query, lookup

**Instruction**:
A standing instruction the user writes once, which the app applies to every Organize — shaping how the Dump is rendered into the Note, such as the language the Note is written in. It never reaches the judgments about where content belongs: founding, Appending, and Related are not its business.
_Avoid_: preference, prompt tweak, system prompt

**Modality**:
Whether an input is voice or text. Applies to both Capture and Retrieve.
_Avoid_: format, type, mode

**Sheet**:
A full-screen surface the app drops over the grid for one focused job — Capture, Ask, Note, or Settings. You drop into a Sheet and return from it; the grid is home. A Sheet is opened and closed, never visited like a place.
_Avoid_: page, modal, screen, popup

**Host**:
The always-on origin the app itself is served from — the installed PWA's home. The Host serves
the app shell and its updates; it is never in the path of a Capture, which talks to the Vault
through CouchDB and the LLM provider directly. The Host going away slows updates, not thoughts.
_Avoid_: serve server, dev server, backend, server

**Vault**:
The user's entire note collection — every document they have, including all the personal notes
the app had no hand in creating. The app reads all of it and writes into none of it except the
Managed folders.
_Avoid_: knowledge base, notes, library, store

**Managed folder**:
A folder inside the Vault that the app is allowed to write into: one holds Notes, another holds
Dumps. Everything else in the Vault is readable but never written, so a document the user made
by hand can be read, cited, and linked to, but never altered by the app.
_Avoid_: app folder, output folder, brain-dump folder, destination
