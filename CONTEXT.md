# Brain-dump

A personal app for capturing a thought the moment it occurs (voice or text), organizing it into a retrievable Note, and later answering questions over the accumulated Notes.

## Language

**Brain-dump**:
The act of capturing a thought in the moment, before it is organized.
_Avoid_: entry, log

**Dump**:
The raw record of a single brain-dump — a voice transcript or typed text, captured verbatim. During the capture session the user may add Context, which edits the Dump while preserving the verbatim original inside it. Once the Note is saved (or the session ends) the Dump is frozen and never changes again. Every Dump is in exactly one of four states — filed into a Note, Pending, Stranded, or Dismissed.
_Avoid_: raw note, transcript, entry

**Context**:
Detail the user adds to a Dump during the capture session, before the Note is saved. The verbatim original is preserved inside the Dump. The final Note is organized from the full Dump (original plus Context); when Context was added it is re-organized at save, and when no Context was added the preview the user approved already is that Organize and is reused as-is.
_Avoid_: addition, edit, note edit

**Note**:
The organized, editable artifact derived from one or more Dumps. The thing you browse, edit, and retrieve. A Note may be re-enriched but its source Dumps are never altered.
_Avoid_: document, file, entry

**Organize**:
The additive enrichment of a Dump into or onto a Note — a title, tags, summary, key points, related links, and category — without altering the source Dump. Every part of this is derived from the Dump alone except the related links, which describe the Note's connections to *other* Notes and so cannot be known from the Dump by itself.
_Avoid_: process, format, clean up, rewrite

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
Adding a Dump's content to an existing Note, rather than founding a new Note. A Dump either founds a new Note or Appends to an existing one.
_Avoid_: merge, update, edit

**Related**:
A connection between two Notes that is real but not strong enough to Append — the two stay separate documents. Any genuine connection counts; Append is the stronger case, where the connection warrants merging the content into one Note. Related and Append are the same judgment at two thresholds.
_Avoid_: similar, linked, see also

**Retrieve**:
Answering a natural-language question by reading the relevant Notes and synthesizing an answer that cites them.
_Avoid_: search, query, lookup

**Modality**:
Whether an input is voice or text. Applies to both Capture and Retrieve.
_Avoid_: format, type, mode

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
