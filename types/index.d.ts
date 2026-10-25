export type TaskStatus = 'pending' | 'in_progress' | 'completed'

// One task from TodoWrite or TaskCreate/TaskUpdate. `agent` is the loop working
// on it: '' for the main conversation, else the subagent's id.
export type Task = {
  label: string
  status: TaskStatus
  agent: string
  activeForm?: string
  seq: number
}

// A subagent, hung under the task its parent had in progress when it spawned it,
// or under the plan task its description names ("Implement Task 3: ...")
export type AgentNode = {
  label: string
  // Its agent type: general-purpose, Explore, ...
  kind?: string
  parent: string
  parentTask?: string
  isDone: boolean
  seq: number
}

export type PlanStep = { label: string; isDone: boolean }

// A `### Task N: title` section of a markdown plan, with its `- [ ]` steps
export type PlanTask = {
  n: string
  title: string
  steps: PlanStep[]
  // The plan's progress ledger says `Task N: complete`
  isLedgerDone: boolean
}

export type Plan = {
  path: string
  ledger?: string
  tasks: PlanTask[]
}

declare module 'claude-code' {
  interface PluginState {
    'task-progress': {
      tasks: Record<string, Task>
      agents: Record<string, AgentNode>
      // What each loop last did, keyed like Task.agent
      activity: Record<string, string>
      // The markdown plan the session is executing, found in what its tools touch
      plan: Plan | null
      // The prompt holds a slash command still being named, so its menu is open
      isSlashMenu: boolean
      // Folded to its one named line by its own hide (h), not the engine's ctrl+x ctrl+a
      isCollapsed: boolean
      // First row of the five shown while the person walks the list; null follows the active task
      windowStart: number | null
      seq: number
    }
  }
}
