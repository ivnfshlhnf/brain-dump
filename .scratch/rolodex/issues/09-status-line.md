# 09 — The status line

**What to build:** One thin live strip on the grid — the app's single cross-cutting voice. It
carries only what belongs to no card: that a capture landed, that the connection went or came
back, and that a setting was rejected.

Queued and failed are deliberately absent. They now live on their own cards, and the rule this
strip is written under is that state belongs on the thing it is about.

It is fed by a callback on the operation layer rather than an event bus, which keeps the source
assertable at the existing test seam and keeps the strip small.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] One live strip sits on the grid and announces politely, without interrupting a screen reader
- [ ] It carries exactly three kinds of message: capture confirmed, connection lost or restored, and a settings rejection
- [ ] Queued and failed states never appear on it
- [ ] The capture confirmation fades on its own; the other two hold until cleared or resolved
- [ ] Every message can be cleared immediately, including one the user would rather deal with later
- [ ] Every message carries a word, never colour alone
- [ ] It is fed by an operation-layer callback, not an event bus, and the source is assertable at the operation-layer seam
- [ ] It does not appear inside any sheet
