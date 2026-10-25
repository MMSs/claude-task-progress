import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'task-progress',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 12,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const TODOS = ['Plan', 'Build parser', 'Write tests', 'Docs', 'Lint', 'Ship', 'Announce'].map((content, i) => ({
  content,
  status: i === 0 ? ('completed' as const) : i === 1 ? ('in_progress' as const) : ('pending' as const),
  activeForm: content,
}))

test('rows, nesting, the five-row window and Enter opening the agent', async ($, on) => {
  const views: (string | undefined)[] = []
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Review parser', type: 'reviewer', status: 'running' as const }],
  }))
  on('ui.view', (_, e) => {
    views.push(e.agentId)
    return { value: {} }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.tool.call({ tool: 'TodoWrite', todos: TODOS })
  await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'Build the parser' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/parser.ts', agentId: 'a1' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const buttons = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row:'))

    // One row per task, opening on the row above the active one; the agent on
    // Build parser sits in its AGENT column rather than a row of its own
    expect(buttons.map(b => b.key)).toEqual(['row:todo::0', 'row:todo::1', 'row:todo::2', 'row:todo::3', 'row:todo::4'])
    expect((await ui.find({ type: 'Text', text: /Review parser/ }))?.text).toContain('Review parser')
    // The agent working on the task carries its line; the task row does not repeat it
    expect(await ui.find({ type: 'Text', text: /Bash: Build the parser/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /Read parser\.ts/ }))?.text).toContain('Read parser.ts')
    expect((await ui.find({ type: 'Text', text: /open agent/ }))?.text).toContain('open agent')
    expect((await ui.find({ type: 'Text', text: /tasks/ }))?.text).toContain('/7 tasks ↓2')

    await ui.press({ key: 'row:todo::1' })
    await ui.press({ key: 'row:todo::2' })
    await ui.unmount()
  }

  // Enter on a task opens the agent working on it; on one nobody is at, the main conversation
  expect(views).toEqual(['a1', undefined, 'a1', undefined])
})

const PLAN = `# Plan

## Global Constraints

- [ ] not a step of any task

### Task 1: Fixtures

- [ ] **Step 1:** Write fixtures

### Task 2: Add the export command

- [ ] **Step 1:** Move tests
- [ ] **Step 2:** Move code

### Task 3: Docs page

- [ ] **Step 1:** Parse it

## Out of scope

- [ ] later
`

const LEDGER = `# SDD ledger — plan: .superpowers/plans/2026-01-01-export.md

Task 1: complete (commits abc1234..def5678, review clean)
`

test('a superpowers plan and its ledger, with the agents named after its tasks', async ($, on) => {
  const files: Record<string, string> = {
    '/repo/.superpowers/plans/2026-01-01-export.md': PLAN,
    '/repo/.superpowers/sdd/2026-01-01-export/progress.md': LEDGER,
  }
  const views: (string | undefined)[] = []
  on('session.cwd', () => ({ value: '/repo' }))
  on('env.get', () => ({ value: '/home' }))
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', description: 'Implement Task 1: fixtures', type: 'general-purpose', status: 'completed' as const },
      { id: 'a2', description: 'Implement Task 2: export command', type: 'general-purpose', status: 'running' as const },
    ],
  }))
  on('ui.view', (_, e) => {
    views.push(e.agentId)
    return { value: {} }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.tool.call({ tool: 'Bash', command: 'sed -n 1,80p .superpowers/plans/2026-01-01-export.md' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/test/fixtures/sample.json', content: '{}', agentId: 'a1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/export.ts', old_string: 'a', new_string: 'b', agentId: 'a2' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const buttons = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row:'))
  // One row per plan task; Task 1's finished agent has no row of its own
  expect(buttons.map(b => b.key)).toEqual(['row:plan:1', 'row:plan:2', 'row:plan:3'])
  expect((await ui.find({ type: 'Text', text: /Implement export command/ }))?.text).toContain('Implement export command')
  expect((await ui.find({ type: 'Text', text: /Edit export\.ts/ }))?.text).toContain('export.ts')

  // Enter on the plan task opens the agent implementing it
  await ui.press({ key: 'row:plan:2' })
  expect(views).toEqual(['a2'])
  await ui.unmount()
})

test('its own hide folds it to one named line, and Enter there unfolds it', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.tool.call({ tool: 'TodoWrite', todos: TODOS })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const rowCount = async () => (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row:')).length

  await ui.press({ key: 'hide' })
  expect(await rowCount()).toBe(0)
  const line = await ui.find({ type: 'Button', key: 'show' })
  expect(line?.text).toContain('Task progress · 1/7 tasks · ● Build parser')

  await ui.press({ key: 'show' })
  expect(await rowCount()).toBe(5)
  await ui.unmount()
})
