import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register } from 'claude-code'

import type { AgentNode, Plan, Task, TaskStatus } from '../types'
import { ledgerPathFor, parsePlan, planPathsIn, resolvePath, taskNumberOf } from './plan'

const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, {})
const agents = atom({ plugin: 'task-progress', key: 'agents' } as const, {})
const activity = atom({ plugin: 'task-progress', key: 'activity' } as const, {})
const models = atom({ plugin: 'task-progress', key: 'models' } as const, {})
const plan = atom({ plugin: 'task-progress', key: 'plan' } as const, null)
const isSlashMenu = atom({ plugin: 'task-progress', key: 'isSlashMenu' } as const, false)
const isCollapsed = atom({ plugin: 'task-progress', key: 'isCollapsed' } as const, false)
const windowStart = atom({ plugin: 'task-progress', key: 'windowStart' } as const, null)
const focusedRow = atom({ plugin: 'task-progress', key: 'focusedRow' } as const, null)
const seq = atom({ plugin: 'task-progress', key: 'seq' } as const, 0)

const MAX_ROWS = 5
// Lines the focused row's DOING may wrap onto
const MAX_DOING_LINES = 6
const PLAN_POLL_MS = 3000
const FINISHED: ReadonlySet<AgentStatus> = new Set(['completed', 'failed', 'killed'])
const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'])
const NAME = 'Task progress'
// The engine's default chord for abovePrompt:focus, then the band's own keys;
// dropped from the end where the row has no room. Hiding is the mod's own `h`:
// the engine's ctrl+x ctrl+a folds the band to a line it names "plugin panel".
const HINT: ReadonlyArray<[string, string]> = [
  ['ctrl+x tab', 'select'],
  ['tab/shift+tab', 'move'],
  ['enter', 'open agent'],
  ['esc', 'back'],
]
// The hide Button after the hints, drawn `h: hide` with its separator
const HIDE_WIDTH = ' · h: hide'.length

const GAP = '  '
// What an empty cell shows
const EMPTY = '—'
// Effort levels as the MODEL column spells them
const EFFORTS: Record<string, string> = { low: 'lo', medium: 'med', high: 'hi', xhigh: 'xhi', max: 'max' }

type RowState = 'done' | 'active' | 'pending' | 'failed'

// One task, or one agent tied to no task: the TASK, AGENT, MODEL and DOING columns
type Row = {
  key: string
  depth: number
  state: RowState
  label: string
  // The loop Enter opens: '' for the main conversation
  agent: string
  // Who is at it now, or did it once it is done; absent while nobody is
  agentLabel?: string
  // That agent's model and effort: "opus hi"
  model?: string
  activity?: string
  // A second (third, ...) agent at the task of the row above, not a task itself
  isAgentLine?: true
}

const ICONS: Record<RowState, string> = { done: '✓', active: '●', pending: '○', failed: '✗' }
const COLORS: Record<RowState, string> = { done: 'success', active: 'claude', pending: 'inactive', failed: 'error' }

async function nextSeq($: EngineInterface): Promise<number> {
  let value = 0
  await update($, seq, n => (value = (n ?? 0) + 1))
  return value
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? ''
}

// What a tool call says the agent is doing: "Edit register.tsx", "Bash: run tests"
function describeCall(tool: string, input: Record<string, unknown>): string {
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined)
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(2).join('__') : tool
  const path = str('file_path') ?? str('notebook_path') ?? str('path')

  switch (tool) {
    case 'Bash':
      return `Bash: ${firstLine(str('description') ?? str('command') ?? '')}`
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return path ? `${tool} ${basename(path)}` : tool
    case 'Grep':
    case 'Glob':
      return `${tool} ${str('pattern') ?? ''}`
    case 'Agent':
      return `Agent: ${str('description') ?? ''}`
    case 'WebSearch':
      return `Search: ${str('query') ?? ''}`
    case 'WebFetch':
      return `Fetch ${str('url')?.replace(/^https?:\/\//, '') ?? ''}`
    case 'Skill':
      return `Skill ${str('skill') ?? ''}`
    default:
      return name
  }
}

// A model and effort as the MODEL column shows them: "claude-opus-5-5", high → "opus hi"
function shortModel(model: string, effort: string | number | undefined): string {
  const name = model.match(/opus|sonnet|haiku|fable/i)?.[0].toLowerCase() ?? model.replace(/^claude-/, '').split(/[-[]/)[0]
  const level = typeof effort === 'number' ? `${Math.round(effort / 1000)}k` : effort && (EFFORTS[effort] ?? effort)
  return level ? `${name} ${level}` : (name ?? model)
}

// `cd` with an absolute or ~ path, after a space or a shell separator
const CD = /(^|[\s;&|(])cd\s+("[^"]*"|'[^']*'|[/~][^\s;&|)]*)/g

// A `cd` into the session's folder or below it, named from that folder:
// "cd /Users/me/dev/app/src && npm test" → "cd ./app/src && npm test"
function shortenCd(text: string, cwd: string, home: string | undefined): string {
  const root = cwd.replace(/\/+$/, '')
  if (!root) return text
  return text.replace(CD, (match, lead: string, arg: string) => {
    const path = resolvePath(arg.replace(/^(["'])(.*)\1$/, '$2'), cwd, home)
    if (path !== root && !path.startsWith(`${root}/`)) return match
    return `${lead}cd ./${basename(root)}${path.slice(root.length)}`
  })
}

// The task a loop has in progress, where a subagent it spawns now gets hung
function activeTask(all: Record<string, Task>, agent: string): string | undefined {
  return Object.entries(all)
    .filter(([, task]) => task.agent === agent && task.status === 'in_progress')
    .sort(([, a], [, b]) => a.seq - b.seq)[0]?.[0]
}

// A spawned agent's place: the plan task its description names, else its parent's active task
function parentTaskFor(description: string, all: Record<string, Task>, parent: string): string | undefined {
  const n = taskNumberOf(description)
  return n ? `plan:${n}` : activeTask(all, parent)
}

// The plan's tasks as rows of the main conversation. A task is done once its
// ledger line or every step says so, active while an agent named after it runs
// or some of its steps are ticked; with none active, the first open one is.
// Shown only once the plan is being executed: a ledger, a ticked step, an agent.
function planTasks(
  current: Plan | null,
  allAgents: Record<string, AgentNode>,
  isRunning: (agent: string) => boolean,
): Record<string, Task> {
  if (!current) return {}
  const agentEntries = Object.entries(allAgents)
  const anyTicked = current.tasks.some(t => t.steps.some(s => s.isDone))
  const anyAgent = agentEntries.some(([, a]) => a.parentTask?.startsWith('plan:'))
  if (!current.ledger && !anyTicked && !anyAgent) return {}

  const out: Record<string, Task> = {}
  let hasActive = false
  current.tasks.forEach((t, i) => {
    const key = `plan:${t.n}`
    const isDone = t.isLedgerDone || (t.steps.length > 0 && t.steps.every(s => s.isDone))
    const isWorked =
      agentEntries.some(([id, a]) => a.parentTask === key && isRunning(id)) || t.steps.some(s => s.isDone)
    const status: TaskStatus = isDone ? 'completed' : isWorked ? 'in_progress' : 'pending'
    hasActive ||= status === 'in_progress'
    out[key] = { label: `${t.n}. ${t.title}`, status, agent: '', seq: -10_000 + i }
  })
  if (!hasActive) {
    const next = Object.values(out).find(t => t.status === 'pending')
    if (next) next.status = 'in_progress'
  }
  return out
}

// One row per task, the agent at it and what that agent is doing beside it. A
// subagent's own tasks follow the task it was spawned for, indented; an agent
// tied to no task is a row of its own.
function buildRows(
  toolTasks: Record<string, Task>,
  currentPlan: Plan | null,
  allAgents: Record<string, AgentNode>,
  allActivity: Record<string, string>,
  allModels: Record<string, string>,
  statuses: ReadonlyMap<string, AgentStatus>,
  isMainWorking: boolean,
): Row[] {
  const isRunning = (agent: string) => {
    if (agent === '') return isMainWorking
    const status = statuses.get(agent)
    return status ? !FINISHED.has(status) : !allAgents[agent]?.isDone
  }

  const allTasks = { ...planTasks(currentPlan, allAgents, isRunning), ...toolTasks }
  const rows: Row[] = []
  const seen = new Set<string>()
  const bySeq = <T extends { seq: number }>(entries: [string, T][]) => entries.sort(([, a], [, b]) => a.seq - b.seq)
  const taskEntries = Object.entries(allTasks)
  const agentEntries = Object.entries(allAgents)
  const hasTasks = (loop: string) => taskEntries.some(([, task]) => task.agent === loop)

  const agentName = (id: string) => {
    const node = allAgents[id]
    if (!node) return 'agent'
    // Beside its plan task the "Task N" is said already: "Implement Task 2: x" → "Implement x"
    return node.parentTask?.startsWith('plan:')
      ? node.label.replace(/\s*\bTask\s+\d+[a-z]?\b:?\s*/i, ' ').trim()
      : node.label
  }

  const emitLoop = (loop: string, depth: number) => {
    for (const [key, task] of bySeq(taskEntries.filter(([, t]) => t.agent === loop))) {
      const state: RowState = task.status === 'completed' ? 'done' : task.status === 'in_progress' ? 'active' : 'pending'
      const children = bySeq(agentEntries.filter(([, a]) => a.parentTask === key))
      const [first, ...others] = children.filter(([id]) => isRunning(id))
      // The first agent still at the task, else the loop that owns it while that runs
      const worker = first?.[0] ?? (state === 'active' && isRunning(loop) ? loop : undefined)
      // A done task keeps who did it: the first agent spawned for it, else its loop
      const doer = state === 'done' ? (children[0]?.[0] ?? loop) : worker
      rows.push({
        key,
        depth,
        state,
        label: task.label,
        agent: doer ?? loop,
        agentLabel: doer === undefined ? undefined : doer === '' ? 'main' : agentName(doer),
        model: doer === undefined ? undefined : allModels[doer],
        activity: state === 'active' ? (worker !== undefined && allActivity[worker]) || task.activeForm : undefined,
      })
      // Every other agent at it gets a line of its own under the task
      for (const [id] of others) {
        rows.push({
          key: `with:${id}`,
          depth,
          state: 'active',
          label: '',
          agent: id,
          agentLabel: agentName(id),
          model: allModels[id],
          activity: allActivity[id],
          isAgentLine: true,
        })
      }
      for (const [id] of children) {
        seen.add(id)
        if (hasTasks(id)) emitLoop(id, depth + 1)
      }
    }
  }

  const emitAgent = (id: string, node: AgentNode) => {
    if (seen.has(id)) return
    seen.add(id)
    const status = statuses.get(id)
    const isDone = node.isDone || (status !== undefined && FINISHED.has(status))
    rows.push({
      key: `agent:${id}`,
      depth: 0,
      state: status === 'failed' || status === 'killed' ? 'failed' : isDone ? 'done' : 'active',
      label: node.label,
      agent: id,
      agentLabel: node.kind ?? 'agent',
      model: allModels[id],
      activity: isDone ? undefined : allActivity[id],
    })
    if (hasTasks(id)) emitLoop(id, 1)
  }

  emitLoop('', 0)
  // Agents tied to no task, and those whose parent this mod never saw
  for (const [id, node] of bySeq(agentEntries)) emitAgent(id, node)
  return rows
}

// The five rows shown while nobody walks the list: from the row above the first active one
function autoStart(rows: Row[]): number {
  const active = rows.findIndex(row => row.state === 'active')
  return clampStart(active === -1 ? rows.length : active - 1, rows.length)
}

function clampStart(start: number, count: number): number {
  return Math.max(0, Math.min(start, count - MAX_ROWS))
}

function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

// Lines of at most `width`, broken at a space where there is one; the last is cut
function wrap(text: string, width: number, max: number): string[] {
  if (width <= 0) return ['']
  const lines: string[] = []
  let rest = text
  while (rest.length > width && lines.length < max - 1) {
    const space = rest.lastIndexOf(' ', width)
    const at = space > 0 ? space : width
    lines.push(rest.slice(0, at))
    rest = rest.slice(at).trimStart()
  }
  lines.push(truncate(rest, width))
  return lines
}

// The rows as drawn: every reader takes the agents' statuses from the engine, since a
// SubagentStop can go unheard and leave a finished agent looking busy
async function readRows($: EngineInterface, isMainWorking: boolean) {
  const statuses = new Map((await $.agent.list()).map(a => [a.id, a.status] as const))
  return buildRows(
    await read($, tasks),
    await read($, plan),
    await read($, agents),
    await read($, activity),
    await read($, models),
    statuses,
    isMainWorking,
  )
}

// Where the window slides when the ring goes to `element`: one row beyond it stays
// drawn on either side. `landOn` is the Button now drawn where the row will be.
async function slideFor($: EngineInterface, element: string) {
  const rows = await readRows($, false)
  const index = rows.findIndex(row => `row:${row.key}` === element)
  if (index === -1 || rows.length <= MAX_ROWS) return undefined
  const current = clampStart((await read($, windowStart)) ?? autoStart(rows), rows.length)
  let start = current
  if (index <= start) start = index - 1
  else if (index >= start + MAX_ROWS - 1) start = index - MAX_ROWS + 2
  start = clampStart(start, rows.length)
  const landOn = rows[current + index - start]
  return start === current || !landOn ? undefined : { start, landOn: `row:${landOn.key}` }
}

// Every task done and every agent finished, so nothing is left to watch
function isAllFinished(rows: Row[]): boolean {
  return rows.every(row => row.state === 'done' || row.state === 'failed')
}

// Agents gone with their own tasks, what they did and their models, and the
// agents they spawned
async function dropAgents($: EngineInterface, ids: Set<string>, live: ReadonlySet<string> = new Set()) {
  const all = await read($, agents)
  for (let grew = true; grew; ) {
    grew = false
    for (const [id, node] of Object.entries(all)) {
      if (ids.has(id) || !ids.has(node.parent) || live.has(id)) continue
      ids.add(id)
      grew = true
    }
  }
  if (ids.size === 0) return
  const keep = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => !ids.has(id)))
  await update($, agents, keep)
  await update($, activity, keep)
  await update($, models, keep)
  await update($, tasks, all => Object.fromEntries(Object.entries(all).filter(([, task]) => !ids.has(task.agent))))
}

// At a new prompt, what is finished goes: all of it, else a plan whose every task
// is done, with the agents that worked on it, and each finished agent of its own
async function forgetFinished($: EngineInterface) {
  const rows = await readRows($, false)
  if (rows.length === 0) return
  if (isAllFinished(rows)) {
    await update($, tasks, () => ({}))
    await update($, agents, () => ({}))
    await update($, activity, () => ({}))
    await update($, plan, () => null)
    return
  }

  // A row and the rows under it, a group drawn as one
  const groups: Row[][] = []
  for (const row of rows) {
    if (row.depth === 0 && !row.isAgentLine) groups.push([row])
    else groups.at(-1)?.push(row)
  }
  const live = new Set(rows.filter(row => row.state === 'active' || row.state === 'pending').map(row => row.agent))
  const planGroups = groups.filter(group => group[0]?.key.startsWith('plan:'))
  const isPlanDone = planGroups.length > 0 && planGroups.every(isAllFinished)
  const ids = new Set(
    groups
      .filter(group => group[0]?.key.startsWith('agent:') && isAllFinished(group))
      .map(group => group[0]?.agent ?? ''),
  )
  if (isPlanDone) {
    for (const [id, node] of Object.entries(await read($, agents))) {
      if (node.parentTask?.startsWith('plan:') && !live.has(id)) ids.add(id)
    }
    await update($, plan, () => null)
  }
  await dropAgents($, ids, live)
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

async function loadPlan($: EngineInterface, path: string): Promise<Plan | undefined> {
  const text = await readText($, path)
  if (text === undefined) return undefined
  const ledgerPath = ledgerPathFor(path)
  const ledger = await readText($, ledgerPath)
  return { path, ledger: ledger === undefined ? undefined : ledgerPath, tasks: parsePlan(text, ledger) }
}

// Follows the plan a tool call or a prompt mentions: the latest one that parses into
// tasks, except that a plan with a ledger is not given up for one without
async function notePlanMentions($: EngineInterface, texts: string[]) {
  const mentioned = texts.flatMap(planPathsIn)
  if (mentioned.length === 0) return
  const cwd = await $.session.cwd()
  const home = await $.env.get('HOME')
  const current = await read($, plan)

  for (const path of [...new Set(mentioned.reverse().map(p => resolvePath(p, cwd, home)))]) {
    if (path === current?.path) return
    const found = await loadPlan($, path)
    if (!found || found.tasks.length === 0) continue
    const isCurrentLive = current?.ledger !== undefined && current.tasks.some(t => !t.isLedgerDone)
    if (isCurrentLive && found.ledger === undefined) return
    // The agents of the plan before it worked on its tasks, not on this one's
    const planAgents = Object.entries(await read($, agents)).filter(([, a]) => a.parentTask?.startsWith('plan:'))
    if (current) await dropAgents($, new Set(planAgents.map(([id]) => id)))
    await update($, plan, () => found)
    await update($, windowStart, () => null)
    return
  }
}

async function refreshPlan($: EngineInterface) {
  const current = await read($, plan)
  if (!current) return
  const found = await loadPlan($, current.path)
  if (!found || JSON.stringify(found) === JSON.stringify(current)) return
  // superpowers deletes a plan's workspace, its ledger with it, at the finish: what the
  // ledger said stands
  if (current.ledger !== undefined && found.ledger === undefined) return
  await update($, plan, () => found)
}

// A subagent seen before its spawn was (one started before this mod loaded)
async function ensureAgent($: EngineInterface, id: string) {
  if ((await read($, agents))[id]) return
  const info = (await $.agent.list()).find(a => a.id === id)
  const parent = info?.parentId ?? ''
  const label = info?.description ?? info?.name ?? 'agent'
  const parentTask = parentTaskFor(label, await read($, tasks), parent)
  const n = await nextSeq($)
  await update($, agents, all =>
    all[id] ? all : { ...all, [id]: { label, kind: info?.type, parent, parentTask, isDone: false, seq: n } },
  )
}

function textsOf(input: Record<string, unknown>): string[] {
  return ['command', 'file_path', 'path', 'prompt', 'description']
    .map(key => input[key])
    .filter((value): value is string => typeof value === 'string')
}

// The typeahead lists commands while the draft is `/` and a name with no space yet
const SLASH_DRAFT = /^\/\S*$/

// Last value written, so a keystroke that changes nothing costs no state write
let wasSlashMenu: boolean | undefined

// Typing at the prompt means the ring has left the band (Esc raises no ui.focus)
async function forgetFocus($: EngineInterface) {
  if ((await read($, focusedRow)) !== null) await update($, focusedRow, () => null)
}

async function noteDraft($: EngineInterface, text: string) {
  await forgetFocus($)
  const isOpen = SLASH_DRAFT.test(text)
  if (isOpen === wasSlashMenu) return
  wasSlashMenu = isOpen
  await update($, isSlashMenu, () => isOpen)
}

export const register: Register = on => {
  // The slash menu opens beneath the prompt and would push the band up, so the
  // band steps aside while it shows
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await noteDraft($, box.text)
    return box
  })

  on('prompt.change', async ($, e, next) => {
    const result = await next(e)
    await noteDraft($, e.text)
    return result
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Steps get ticked and ledger lines appended by tools this mod never sees run
    // (a shell redirect, an editor), so the plan is read again on a timer
    $.clock.every(PLAN_POLL_MS, () => void refreshPlan($))
    await refreshPlan($)
    return result
  })

  // These hooks only watch, never refuse: when one fails, the action goes on as if
  // it were not there
  on('prompt.submit', async ($, e, next) => {
    await forgetFinished($)
    await forgetFocus($)
    await update($, windowStart, () => null)
    await update($, activity, all => ({ ...all, '': '' }))
    await notePlanMentions($, [e.text])
    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    await notePlanMentions($, [e.prompt])
    const result = await next(e)
    const id = result.agentId
    if (id) {
      const parent = e.parentAgentId ?? ''
      const parentTask = parentTaskFor(e.description, await read($, tasks), parent)
      const n = await nextSeq($)
      await update($, agents, all => ({
        ...all,
        [id]: { label: e.description, kind: e.subagentType, parent, parentTask, isDone: false, seq: all[id]?.seq ?? n },
      }))
    }
    return result
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    await update($, agents, all => {
      const node = all[e.agent_id]
      return node ? { ...all, [e.agent_id]: { ...node, isDone: true } } : all
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const agent = e.agentId ?? ''
    const input = e as unknown as Record<string, unknown>

    if (agent) await ensureAgent($, agent)
    if (!TASK_TOOLS.has(tool)) {
      const text = describeCall(tool, input)
      await update($, activity, all => ({ ...all, [agent]: text }))
      const result = await next(e)
      // After the call, so a plan or ledger the call just wrote is read as written
      await notePlanMentions($, textsOf(input))
      return result
    }

    const result = await next(e)
    if (result.deny !== undefined || result.isError) return result

    if (e.tool === 'TodoWrite') {
      const prefix = `todo:${agent}:`
      const base = await nextSeq($)
      await update($, tasks, all => {
        const kept = Object.fromEntries(Object.entries(all).filter(([key]) => !key.startsWith(prefix)))
        e.todos.forEach((todo, i) => {
          kept[`${prefix}${i}`] = {
            label: todo.content,
            status: todo.status,
            agent,
            activeForm: todo.activeForm,
            seq: (all[`${prefix}${i}`]?.seq ?? base) + i / 1000,
          }
        })
        return kept
      })
      await update($, windowStart, () => null)
    } else if (e.tool === 'TaskCreate') {
      const created = result.result as { task?: { id?: string } } | undefined
      const id = created?.task?.id
      if (id) {
        const n = await nextSeq($)
        await update($, tasks, all => ({
          ...all,
          [`task:${id}`]: { label: e.subject, status: 'pending' as const, agent, activeForm: e.activeForm, seq: n },
        }))
      }
    } else if (e.tool === 'TaskUpdate') {
      const key = `task:${e.taskId}`
      const n = await nextSeq($)
      await update($, tasks, all => {
        if (e.status === 'deleted') {
          const { [key]: _gone, ...rest } = all
          return rest
        }
        const prev: Task = all[key] ?? { label: `#${e.taskId}`, status: 'pending', agent, seq: n }
        const status: TaskStatus = e.status ?? prev.status
        return {
          ...all,
          [key]: {
            ...prev,
            label: e.subject ?? prev.label,
            activeForm: e.activeForm ?? prev.activeForm,
            status,
            // Whoever starts a task is the one working on it
            agent: e.status === 'in_progress' ? agent : prev.agent,
          },
        }
      })
      if (e.status) await update($, windowStart, () => null)
    }
    return result
  }).catch(($, e, next) => next(e))

  // Each loop's model and effort, as its latest request named them
  on('turn.step', async function* ($, e, next) {
    const loop = e.agentId ?? ''
    const text = shortModel(e.model, e.effort)
    if ((await read($, models))[loop] !== text) await update($, models, all => ({ ...all, [loop]: text }))
    return yield* next(e)
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  // Walking the list: the row the ring lands on wraps its DOING, and past the fifth
  // row the window slides so the next row is drawn before the ring reaches for it
  on('ui.focus', async ($, e, next) => {
    if (e.component !== 'AbovePrompt') return next(e)
    const isRow = e.plugin === 'task-progress' && e.element?.startsWith('row:')
    const slide = isRow ? await slideFor($, e.element ?? '') : undefined
    // The engine's ring holds a place in the band's Buttons, not a Button, so after
    // a slide that place shows another row: it lands where the row will be drawn
    const result = await next(slide ? { ...e, element: slide.landOn } : e)
    if (result.deny !== undefined) return result
    await update($, focusedRow, () => (isRow ? (e.element ?? null) : null))
    if (slide) await update($, windowStart, () => slide.start)
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || (await read($, isSlashMenu))) return below

    const rows = await readRows($, e.props.isWorking)
    // Gone once the work is done; the next prompt clears what is left
    if (isAllFinished(rows)) return below

    const { Box, Button, Text } = $.ui.resolve(e)

    // The "done/total tasks" count, left out while only agents tied to no task are listed
    const tasksOnly = rows.filter(
      row => !row.key.startsWith('agent:') && !row.key.includes(':step:') && !row.isAgentLine,
    )
    const done = tasksOnly.filter(row => row.state === 'done').length
    const count = tasksOnly.length > 0 ? ` · ${done}/${tasksOnly.length} tasks` : ''
    const countView = count ? (
      <Text>
        <Text dimColor>{' · '}</Text>
        <Text color="success">{done}</Text>
        <Text dimColor>/{tasksOnly.length} tasks</Text>
      </Text>
    ) : (
      ''
    )

    if (await read($, isCollapsed)) {
      const active = rows.find(row => row.state === 'active')
      const head = `▸ ${NAME}${count}`
      const tail = '  enter to show'
      const now = active ? truncate(`${ICONS.active} ${active.label}`, e.props.bodyColumns - head.length - tail.length - 3) : ''

      return (
        <Box flexDirection="column">
          {below}
          {/* Folded: color only on the arrow, the count and the active dot, so it is spotted without glaring */}
          <Box marginTop={1}>
            <Button key="show" plain onPress={() => update($, isCollapsed, () => false)}>
              <Text color="claude">▸ </Text>
              <Text bold>{NAME}</Text>
              {countView}
              {now ? <Text dimColor>{' · '}</Text> : ''}
              {now ? <Text color="claude">{now.slice(0, 1)}</Text> : ''}
              {now ? now.slice(1) : ''}
              <Text dimColor>{tail}</Text>
            </Button>
          </Box>
        </Box>
      )
    }

    const start = clampStart((await read($, windowStart)) ?? autoStart(rows), rows.length)
    const shown = rows.slice(start, start + MAX_ROWS)
    const hiddenAbove = start
    const hiddenBelow = rows.length - start - shown.length

    // Inside the border and its padding
    const inner = e.props.bodyColumns - 4
    const viewed = e.props.view.agentId ?? ''

    // TASK, AGENT, MODEL and DOING columns after the status glyph, two spaces apart,
    // sized from every row (not just the five shown, so scrolling never moves them):
    // MODEL its widest value, TASK up to 45% and AGENT up to 25% of the room left,
    // DOING the rest; room DOING does not use goes back to TASK and AGENT. Every
    // cell is cut to its width, so a row never wraps.
    const natural = (texts: string[], title: string) => Math.max(title.length, ...texts.map(t => t.length))
    const modelColumn = natural(rows.map(row => row.model ?? EMPTY), 'MODEL')
    const room = inner - 2 - 3 * GAP.length - modelColumn
    const taskWant = natural(rows.map(row => '  '.repeat(row.depth) + row.label), 'TASK')
    const agentWant = natural(rows.map(row => row.agentLabel ?? EMPTY), 'AGENT')
    const doingWant = natural(rows.map(row => firstLine(row.activity ?? EMPTY)), 'DOING')
    let taskColumn = Math.min(taskWant, Math.floor(room * 0.45))
    let agentColumn = Math.min(agentWant, Math.floor(room * 0.25))
    let slack = room - taskColumn - agentColumn - doingWant
    if (slack > 0) {
      const toTask = Math.min(slack, taskWant - taskColumn)
      taskColumn += toTask
      slack -= toTask
      agentColumn += Math.min(slack, agentWant - agentColumn)
    }
    const doingColumn = room - taskColumn - agentColumn
    const cell = (text: string, width: number) => truncate(text, width).padEnd(width)

    // A command too wide for DOING has its `cd` into the session's folder shortened;
    // one that fits is shown as written
    const overflows = (row: Row) => firstLine(row.activity ?? EMPTY).length > doingColumn
    let place: { cwd: string; home: string | undefined } | undefined
    if (shown.some(row => overflows(row) && row.activity?.startsWith('Bash: '))) {
      try {
        place = { cwd: await $.session.cwd(), home: await $.env.get('HOME') }
      } catch {
        place = undefined
      }
    }
    const doing = (row: Row) => {
      const text = firstLine(row.activity ?? EMPTY)
      return place && overflows(row) && text.startsWith('Bash: ') ? shortenCd(text, place.cwd, place.home) : text
    }
    // The focused row's DOING is drawn whole, as written, on lines under it in its own column
    const focused = await read($, focusedRow)
    const doingIndent = ' '.repeat(2 + taskColumn + agentColumn + modelColumn + 3 * GAP.length)

    const scrolled = `${hiddenAbove > 0 ? ` ↑${hiddenAbove}` : ''}${hiddenBelow > 0 ? ` ↓${hiddenBelow}` : ''}`
    const summary = `${NAME}${count}${scrolled}`
    let hintRoom = inner - summary.length - 2 - HIDE_WIDTH
    const hint = HINT.filter(([keys, what]) => {
      const cost = keys.length + what.length + 4
      if (cost > hintRoom) return false
      hintRoom -= cost
      return true
    })

    const open = async (agent: string) => {
      const shownView = await $.ui.view(agent ? { agentId: agent } : {})
      if (shownView.deny) $.ui.toast(shownView.deny)
    }

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginTop={1}>
          <Text bold dimColor>
            {'  '}
            {cell('TASK', taskColumn)}
            {GAP}
            {cell('AGENT', agentColumn)}
            {GAP}
            {cell('MODEL', modelColumn)}
            {GAP}
            DOING
          </Text>
          {shown.map(row => {
            const isDone = row.state === 'done'
            const isViewed = viewed !== '' && row.agent === viewed && !isDone
            const isFocused = focused === `row:${row.key}`
            // Under the focus's inverse a dim cell turns grey and the rest black, so the
            // focused row is drawn at one strength for one color across it
            const isDim = (dim: boolean) => dim && !isFocused
            const [first, ...more] = isFocused
              ? wrap(firstLine(row.activity ?? EMPTY), doingColumn, MAX_DOING_LINES)
              : [truncate(doing(row), doingColumn)]

            return [
              <Button key={`row:${row.key}`} plain onPress={() => open(row.agent)}>
                {row.isAgentLine ? (
                  <Text dimColor={isDim(true)}>
                    {'  '}
                    {cell(`${'  '.repeat(row.depth)}└`, taskColumn)}
                  </Text>
                ) : (
                  <Text>
                    <Text color={COLORS[row.state]}>{ICONS[row.state]}</Text>{' '}
                    <Text bold={row.state === 'active'} dimColor={isDim(isDone)}>
                      {cell('  '.repeat(row.depth) + row.label, taskColumn)}
                    </Text>
                  </Text>
                )}
                {GAP}
                <Text dimColor={isDim(!row.agentLabel || isDone)} underline={isViewed}>
                  {cell(row.agentLabel ?? EMPTY, agentColumn)}
                </Text>
                {GAP}
                <Text dimColor={isDim(true)}>{cell(row.model ?? EMPTY, modelColumn)}</Text>
                {GAP}
                <Text dimColor={isDim(true)}>{first}</Text>
              </Button>,
              // The engine's inverse marks the Button's line alone, so its further lines take it here
              ...more.map((line, i) => (
                <Text key={`more:${row.key}:${i}`} inverse>
                  {doingIndent}
                  {line}
                </Text>
              )),
            ]
          })}
          <Box flexDirection="row" justifyContent="space-between">
            <Text>
              <Text color="claude" bold>
                {NAME}
              </Text>
              {countView}
              <Text dimColor>{scrolled}</Text>
            </Text>
            <Box flexDirection="row">
              <Text>
                {hint.map(([keys, what], i) => (
                  <Text>
                    {i > 0 ? <Text dimColor> · </Text> : ''}
                    <Text color="claude">{keys}</Text>
                    <Text dimColor> {what}</Text>
                  </Text>
                ))}
                <Text dimColor>{hint.length > 0 ? ' · ' : ''}</Text>
              </Text>
              <Button key="hide" plain hotkey="h" dimColor onPress={() => update($, isCollapsed, () => true)}>
                hide
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  })
}
