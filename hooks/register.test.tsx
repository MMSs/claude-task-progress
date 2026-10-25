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

test('a subagent tied to no task gets a row, and no task count is shown', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Research requests', type: 'general-purpose', status: 'running' as const }],
  }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.tool.call({ tool: 'Read', file_path: '/repo/src/api.ts', agentId: 'a1' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const buttons = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row:'))
  expect(buttons.map(b => b.key)).toEqual(['row:agent:a1'])
  expect(await ui.find({ type: 'Text', text: /tasks/ })).toBeUndefined()

  await ui.press({ key: 'hide' })
  const line = await ui.find({ type: 'Button', key: 'show' })
  expect(line?.text).toContain('Task progress · ● Research requests')
  expect(line?.text).not.toContain('tasks')
  await ui.unmount()
})

test('it is gone once every task is done and every agent has finished', async ($, on) => {
  let status: 'running' | 'completed' = 'running'
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Research requests', type: 'general-purpose', status }],
  }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.tool.call({ tool: 'TodoWrite', todos: TODOS.map(t => ({ ...t, status: 'completed' as const })) })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/api.ts', agentId: 'a1' })
  const rowCount = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isWorking: false } })
    const count = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row:')).length
    await ui.unmount()
    return count
  }

  // The agent still at work keeps it up
  expect(await rowCount()).toBeGreaterThan(0)
  status = 'completed'
  expect(await rowCount()).toBe(0)
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

test('a command too wide for DOING has its cd into the session folder shortened', async ($, on) => {
  on('session.cwd', () => ({ value: '/Users/me/dev/app' }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Research requests', type: 'general-purpose', status: 'running' as const }],
  }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const doing = async (command: string) => {
    await $.tool.call({ tool: 'Bash', command, agentId: 'a1' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const text = (await ui.find({ type: 'Text', text: /^Bash: / }))?.text
    await ui.unmount()
    return text
  }

  // Too wide: the folder is named, what follows kept
  expect(await doing('cd /Users/me/dev/app/hooks && npm test -- --reporter=verbose --watch=false')).toBe(
    'Bash: cd ./app/hooks && npm test -- --reporter=verbose --watch=false',
  )
  expect(await doing('cd ~/dev/app && git log --oneline --graph --decorate --all --max-count=40 -- hooks')).toContain(
    'Bash: cd ./app && git log',
  )
  // Fits: shown as written
  expect(await doing('cd /Users/me/dev/app')).toBe('Bash: cd /Users/me/dev/app')
  // Outside the session folder: left alone
  expect(await doing('cd /tmp/elsewhere && npm test -- --reporter=verbose --runInBand --watch=false --coverage')).toContain(
    'Bash: cd /tmp/elsewhere && npm',
  )
})

test('the focused row wraps its DOING onto lines under it; the others stay one line', async ($, on) => {
  const command = `cd /Users/me/dev/app && ${Array.from({ length: 12 }, (_, i) => `step-${i}`).join(' && ')}`
  on('session.cwd', () => ({ value: '/Users/me/dev/app' }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Research requests', type: 'general-purpose', status: 'running' as const }],
  }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.focus', () => ({}))
  on('prompt.change', (_, e) => ({ text: e.text }))

  await $.tool.call({ tool: 'Bash', command, agentId: 'a1' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const doingLines = async () => (await ui.findAll({ type: 'Text', text: /step-|Bash: / })).map(t => t.text.trim())

  // Unfocused: one line, cut, its cd shortened
  expect(await doingLines()).toEqual([expect.stringMatching(/^Bash: cd \.\/app && step-0 .*…$/)])

  await $.ui.focus({
    component: 'AbovePrompt',
    requestId: BAND.requestId,
    plugin: 'task-progress',
    element: 'row:agent:a1',
    origin: { kind: 'person' },
  })
  await ui.redraw()
  const lines = await doingLines()
  expect(lines.length).toBeGreaterThan(1)
  expect(lines.join(' ')).toBe(`Bash: ${command}`)

  // Typing at the prompt hands the keys back: one line again
  await $.prompt.change({ text: 'x' })
  await ui.redraw()
  expect((await doingLines()).length).toBe(1)
  await ui.unmount()
})
