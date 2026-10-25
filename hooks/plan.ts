import type { PlanTask } from '../types'

// Plans as superpowers' writing-plans skill lays them out: `### Task N: title`
// sections holding `- [ ] **Step k:** ...` checkboxes, and a ledger beside them
// at `<root>/sdd/<plan name>/progress.md` that gains `Task N: complete` lines
const HEADING = /^#{2,4}\s+Task\s+(\d+[a-z]?)\b[:.)]?\s*(.*)$/i
const STEP = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/
const LEDGER_DONE = /\bTask\s+(\d+[a-z]?)\**\s*[:\-–—]\s*\**\s*(?:complete|completed|done)\b/i
const PLAN_PATH = /[\w.~/-]*\bplans\/[\w.-]+\.md\b/g
const SDD_DIR = /([\w.~/-]*?)\.superpowers\/sdd\/([\w.-]+)/g
const TASK_REF = /\bTask\s+(\d+[a-z]?)\b/i

function plain(text: string): string {
  return text.replace(/\*\*|__|`/g, '').trim()
}

export function parsePlan(text: string, ledger: string | undefined): PlanTask[] {
  const done = new Set<string>()
  for (const line of ledger?.split('\n') ?? []) {
    const match = line.match(LEDGER_DONE)
    if (match?.[1]) done.add(match[1].toLowerCase())
  }

  const tasks: PlanTask[] = []
  let current: PlanTask | undefined
  let level = 0
  let fence = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    const heading = line.match(HEADING)
    if (heading?.[1]) {
      const n = heading[1].toLowerCase()
      current = { n, title: plain(heading[2] ?? ''), steps: [], isLedgerDone: done.has(n) }
      level = line.indexOf(' ')
      tasks.push(current)
      continue
    }
    // A heading no deeper than the task's that is no task ends it ("## Out of scope")
    const other = line.match(/^(#+)\s/)
    if (other?.[1] && other[1].length <= level) {
      current = undefined
      continue
    }
    const step = line.match(STEP)
    if (step?.[2] && current) current.steps.push({ label: plain(step[2]), isDone: step[1] !== ' ' })
  }
  return tasks
}

// Plan paths a command, a file path or a prompt mentions, in the order written
export function planPathsIn(text: string): string[] {
  const found: { at: number; path: string }[] = []
  for (const match of text.matchAll(PLAN_PATH)) found.push({ at: match.index ?? 0, path: match[0] })
  for (const match of text.matchAll(SDD_DIR)) {
    const stem = match[2] ?? ''
    if (stem && !stem.endsWith('.md')) {
      found.push({ at: match.index ?? 0, path: `${match[1] ?? ''}.superpowers/plans/${stem}.md` })
    }
  }
  return found.sort((a, b) => a.at - b.at).map(f => f.path)
}

export function resolvePath(path: string, cwd: string, home: string | undefined): string {
  if (path.startsWith('/')) return path
  if (path.startsWith('~/') && home) return `${home}${path.slice(1)}`
  const parts = `${cwd}/${path}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

// Where superpowers keeps the ledger for a plan: `<root>/sdd/<name>/progress.md`
// beside `<root>/plans/<name>.md`
export function ledgerPathFor(planPath: string): string {
  const parts = planPath.split('/')
  const name = (parts.pop() ?? '').replace(/\.md$/, '')
  parts.pop()
  return `${parts.join('/')}/sdd/${name}/progress.md`
}

// "Implement Task 2: export command" → "2"
export function taskNumberOf(description: string): string | undefined {
  return description.match(TASK_REF)?.[1]?.toLowerCase()
}
