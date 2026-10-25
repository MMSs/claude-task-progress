# Task progress

A [Claude Code](https://claude.com/claude-code) plugin that keeps a five-row
progress sheet above the prompt: every task the session is working through,
which agent is on it, that agent's model, and what it is doing right now.

```
╭──────────────────────────────────────────────────────────────────────────────╮
│   TASK                     AGENT              MODEL      DOING               │
│ ✓ 1. Fixtures              Implement fixtur…  sonnet hi  —                   │
│ ● 2. Add export command    Implement export…  sonnet hi  Edit export.ts      │
│ ○ 3. Docs page             —                  —          —                   │
│ ● Research API limits      Explore            haiku med  Read api.md         │
│ Task progress · 1/3 tasks   ctrl+x tab select · tab/shift+tab move · h: hide │
╰──────────────────────────────────────────────────────────────────────────────╯
```

## What it tracks

- **Plans run with [superpowers](https://github.com/obra/superpowers)**
  (subagent-driven development): the plan's `### Task N:` sections, their
  `- [ ]` steps and the `.superpowers/sdd/<plan>/progress.md` ledger. Subagents
  described "Implement Task N: …" or "Review Task N …" are placed on that task.
  The plan is picked up the first time a tool call or prompt mentions its path,
  and re-read every three seconds. When superpowers deletes the ledger at the
  finish, the tasks it marked complete stay done.
- **TodoWrite / TaskCreate / TaskUpdate** lists, from the main conversation or
  any subagent; a subagent's own tasks are indented under the task it was
  spawned for.
- **Subagents tied to no task** get a row of their own, named by their
  description, with their agent type as AGENT.

## The rows

| Column | Shows |
| --- | --- |
| status | ✓ done, ● in progress, ○ pending, ✗ failed |
| TASK | The task: a plan task as `N. title` |
| AGENT | The agent working on it, `main` for the main conversation. A done task keeps the agent that did it |
| MODEL | That agent's model and effort: `opus hi`, `sonnet xhi`, `haiku med` |
| DOING | Its latest tool call: `Edit export.ts`, `Bash: run tests` |

- A task several agents are at gets a `└` line under it for each further
  agent, with its own AGENT, MODEL and DOING.
- Columns are sized from every row, so scrolling never moves them. MODEL is as
  wide as its widest value; the rest is shared by TASK, AGENT and DOING, and a
  cell too long for its column is cut with `…`. A command too wide for DOING has
  a `cd` into the session's folder shortened to `cd ./<folder>` first.
- Only five rows show at once; the footer counts the ones above and below
  (`↑9 ↓2`). The `x/y tasks` count is shown only when there are tasks.
- The row the focus is on is highlighted, and its DOING is drawn whole and as
  written, wrapped onto up to six lines under it.

## When it clears

- The sheet steps aside while the `/` command menu is open.
- Once every task is done and every agent has finished, it goes away, and the
  next prompt clears it.
- Short of that, the next prompt clears what is finished: a plan whose every
  task is done, with the agents that worked on it, and each finished agent tied
  to no task. A new plan starts on a clean sheet even while other work runs.

## Keys

| Key | What it does |
| --- | --- |
| `ctrl+x tab` | Focus the sheet (Claude Code's `abovePrompt:focus`) |
| `tab` / `shift+tab` | Move between rows; the five-row window scrolls with the focus |
| `enter` | Open the transcript of the row's agent: the one at work, or the one that did a done task |
| `esc` | Back to the prompt |
| `h` | Fold the sheet to one line; `enter` on that line unfolds it |

### Another key to focus it

Bind `abovePrompt:focus` in `~/.claude/keybindings.json`; the sheet's hint
shows the key you bound, and follows the file as you edit it. For example,
`ctrl+up` in place of `ctrl+x tab`:

```json
{ "bindings": [{ "context": "Chat", "bindings": { "ctrl+x tab": null, "ctrl+up": "abovePrompt:focus" } }] }
```

On macOS, `ctrl+up` opens Mission Control unless that shortcut is turned off in
System Settings → Keyboard → Keyboard Shortcuts → Mission Control.

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
- MODEL fills in at an agent's next model request after the plugin loads; an
  agent that finished before then shows `—`.
- Claude Code does not tell plugins when `esc` leaves the sheet, so the last
  focused row stays expanded until you type at the prompt.
- An agent that starts or finishes while the plugin is reloading can be missed
  and stay shown as running.
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
