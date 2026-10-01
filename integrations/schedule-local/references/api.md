# Local API v1

`Schedule.Cli.exe --request request.json` accepts a UTF-8 JSON file; without arguments it reads a single JSON request from stdin. `--help` prints usage. Output is one JSON object. Exit 0 means `ok: true`; exit 1 means failure. Success includes `revision` and `result`. Errors contain `ok: false` and `error`.

All writes require the `revision` from a current read. Revisions cover journal content, projects, events and embedded images, so a conflicting change anywhere requires a fresh read. Reads include current GUI edits after flushing them safely to disk. Open modal dialogs or active IME composition return `BUSY`. API requests execute sequentially in the desktop process. No direct-file write fallback exists.

| op | Fields | Result |
|---|---|---|
| `capabilities` | none | API version and operation list |
| `list_projects` | none | `{id,name,root}[]` |
| `get_day` | `date` | `{date,record,ideas}` with raw body, formats, file links, appointments and idea metadata |
| `get_project` | `id` (or `unbound`) | Project and dated ideas |
| `search` | `query` | Matching ideas, dates, project names, events and resources across all dates |
| `create_project` | `revision,name,root?` | New project |
| `add_idea` | `revision,date,text,projectIds?,important?,dueDate?,taskState?` | `{date,idea}` with stable ID |
| `update_idea` | `revision,date,id,text?,projectIds?,important?,dueDate?,taskState?` | Updated idea; unspecified fields remain unchanged |
| `save_event` | `revision,date,id?,event` | Event with stable ID; omit id to create |
| `delete_event` | `revision,date,id` | `{removed:true}` |

Dates use `YYYY-MM-DD`. `dueDate: ""` removes a deadline. `projectIds: []` unbinds an idea. `text` may contain newlines and TeX; do not include leading `• ` markers, since each request creates or updates one idea. `get_day` returns raw image tokens in body; image bytes remain in the application's embedded storage and are preserved during text edits.

`taskState` is `note`, `todo`, or `done`. Ordinary notes stay out of Todo. Completion implies a task; reopening a completed idea keeps it in Todo. `note` clears the deadline and detaches linked events, retaining them as standalone events. Do not combine `taskState` with legacy `todo`/`done` fields. Legacy writes remain supported: `done:true` implies `todo:true`, reopening retains `todo:true`, and `todo:false` converts to an ordinary note. Reads retain compatible `done`, `todo`, and `dueDate` metadata. State is derived in this order: done, then todo/deadline, otherwise note. A nonempty deadline cannot be combined with an explicit note conversion.

`important:true` raises priority. Todo offers pending/completed tabs and ordinary/important/scheduled filters. Linked events and their idea appear as one task, even across dates. Multiple project bindings do not duplicate a task.

An event is `{title,time,at,remindMinutes,important,done}`. `time` is `HH:mm`; `at` is an ISO timestamp for the same local day and time, preferably with an explicit offset. `remindMinutes` is one of `-1,0,5,15,30,60`; `-1` disables reminders. Past reminder times are rejected unless the event is complete. Completing an event cancels its own reminder. A notification permission failure can return a saved event with `status:"error"` and an `error` message; disclose this distinction.

Optional `ideaDate` and `ideaId` link an event to an existing task. First set the idea to `todo` or `done`, read the new revision, then save the event with matching `done`. The idea owns completion: change it with `update_idea`, which synchronizes linked events and their Windows reminders. Attempting to change a linked event's completion independently is rejected. Omit both link fields (or set `ideaId:null`) when saving an event to detach it. Removing a linked event retains the idea. Removing the idea or converting it to a note retains the event as a standalone event.

Example read:

```json
{"op":"get_day","date":"2026-10-01"}
```

Then use that response's revision:

```json
{"op":"add_idea","date":"2026-10-01","text":"Review the experiment results","projectIds":[],"important":true,"dueDate":"2026-10-03","revision":"<revision from read>"}
```

The installed application path is recorded by `Install-AssistantSkills.ps1`. Installation creates this skill under `$CODEX_HOME/skills/schedule-local` (or `~/.codex/skills/schedule-local`) for Codex and `~/.claude/skills/schedule-local` for Claude Code. It does not modify either tool's model, permissions or unrelated configuration.

Skill conventions: [Codex skills](https://developers.openai.com/codex/skills) and [Claude Code skills](https://code.claude.com/docs/en/skills).
