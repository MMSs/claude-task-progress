# Task progress

A [Claude Code](https://claude.com/claude-code) plugin that keeps a five-line
progress sheet above the prompt: every task the session is working through,
which agent is on it, and what that agent is doing right now.

```
╭──────────────────────────────────────────────────────────────────────────────╮
│   TASK                          AGENT                 DOING                  │
│ ✓ Fixtures                      —                     —                      │
│ ● Add the export command        Implement             Edit export.ts         │
│ ○ Docs page                     —                     —                      │
│ Task progress · 1/3 tasks     ctrl+x tab select · enter open agent · h: hide │
╰──────────────────────────────────────────────────────────────────────────────╯
```

## What it tracks

- **Plans run with [superpowers](https://github.com/obra/superpowers)**
  (subagent-driven development): the plan's `### Task N:` sections, their
  `- [ ]` steps and the `.superpowers/sdd/<plan>/progress.md` ledger. Subagents
  described "Implement Task N: …" or "Review Task N …" are placed on that task.
  The plan is picked up the first time a tool call or prompt mentions its path,
  and re-read every three seconds.
- **TodoWrite / TaskCreate / TaskUpdate** lists, from the main conversation or
  any subagent; a subagent's own tasks are indented under the task it was
  spawned for.
- **Subagents tied to no task** get a row of their own.

Each row shows a status (✓ done, ● in progress, ○ pending, ✗ failed), the
task, the agent working on it, and that agent's latest tool call
("Edit export.ts", "Bash: run tests"). Rows are cut to fit, never wrapped.
The sheet steps aside while the `/` command menu is open, and goes away once
every task is done and every agent has finished. The `x/y tasks` count is
shown only when there are tasks.

## Keys

| Key | What it does |
| --- | --- |
| `ctrl+x tab` | Focus the sheet (Claude Code's `abovePrompt:focus`) |
| `tab` / `shift+tab` | Move between rows; the five-row window scrolls |
| `enter` | Open the transcript of the agent working on that task |
| `esc` | Back to the prompt |
| `h` | Fold the sheet to one line; `enter` on that line unfolds it |

To focus it with a single key, bind `abovePrompt:focus` in
`~/.claude/keybindings.json`, for example:

```json
{ "bindings": [{ "context": "Chat", "bindings": { "meta+j": "abovePrompt:focus" } }] }
```

## Requirements

Claude Code 2.1.310 or later (plugins with function-hook modules). Tested on
macOS in the terminal.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install task-progress --marketplace MMSs/claude-task-progress
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in
every session).

From a shell:

```sh
claude plugin install task-progress --marketplace MMSs/claude-task-progress
```

Update with `/plugin update task-progress`, remove with
`/plugin uninstall task-progress`.

## Limitations

- A plan is found only once its path shows up in a tool call or prompt, so
  right after a reload the sheet stays empty until the next mention.
- Plans in other layouts than superpowers' are not recognised.
- Claude Code's own `ctrl+x ctrl+a` folds the band to a line labelled
  "plugin panel"; use `h` instead to keep the name.

## Development

```sh
claude plugin validate .
claude plugin test .
claude --plugin-dir .   # run a session with this checkout loaded
```

## License

[MIT](LICENSE)
