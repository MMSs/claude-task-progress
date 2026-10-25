import { expect, mock, test } from 'claude-code/testing'

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

test('a task several agents are at shows a line for each, Enter on it opening that agent', async ($, on) => {
  const views: (string | undefined)[] = []
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', description: 'Build lexer', type: 'implementer', status: 'running' as const },
      { id: 'a2', description: 'Review lexer', type: 'reviewer', status: 'running' as const },
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

  await $.tool.call({ tool: 'TodoWrite', todos: TODOS.slice(0, 3) })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/lexer.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/lexer.test.ts', agentId: 'a2' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const buttons = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row:'))
  expect(buttons.map(b => b.key)).toEqual(['row:todo::0', 'row:todo::1', 'row:with:a2', 'row:todo::2'])
  expect(buttons[1]?.text).toContain('Build lexer')
  expect(buttons[1]?.text).toContain('Edit lexer.ts')
  expect(buttons[1]?.text).not.toContain('+1')
  expect(buttons[2]?.text).toContain('└')
  expect(buttons[2]?.text).toContain('Review lexer')
  expect(buttons[2]?.text).toContain('Read lexer.test.ts')
  // Agent lines are not tasks
  expect((await ui.find({ type: 'Text', text: /tasks/ }))?.text).toContain('1/3 tasks')

  await ui.press({ key: 'row:with:a2' })
  expect(views).toEqual(['a2'])
  await ui.unmount()
})

test('a plan keeps its finished tasks done once the ledger is deleted at the finish', async ($, on) => {
  const files: Record<string, string> = {
    '/repo/.superpowers/plans/2026-01-01-export.md': PLAN,
    '/repo/.superpowers/sdd/2026-01-01-export/progress.md': `${LEDGER}Task 2: complete\nTask 3: complete\n`,
  }
  const clock = mock.clock(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('env.get', () => ({ value: '/home' }))
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('tool.call', (_, e) => ({ result: e.tool === 'TaskCreate' ? { task: { id: '1' } } : {} }))
  on('agent.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'sed -n 1,80p .superpowers/plans/2026-01-01-export.md' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Final whole-branch review', description: 'Review it' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  const count = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const text = (await ui.find({ type: 'Text', text: /tasks/ }))?.text
    await ui.unmount()
    return text
  }
  expect(await count()).toContain('3/4 tasks')

  // superpowers' Finish: `rm -rf` the plan's workspace, the ledger with it
  delete files['/repo/.superpowers/sdd/2026-01-01-export/progress.md']
  await clock.advance(10_000)
  expect(await count()).toContain('3/4 tasks')
})

test('walking the rows draws the next one, whatever an agent left stale', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  // a2 finished with no SubagentStop heard, as a background agent can
  on('agent.list', () => ({
    value: [
      { id: 'a1', description: 'Build lexer', type: 'implementer', status: 'running' as const },
      { id: 'a2', description: 'Review lexer', type: 'reviewer', status: 'completed' as const },
    ],
  }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.focus', () => ({}))

  await $.tool.call({ tool: 'TodoWrite', todos: TODOS })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/lexer.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/lexer.test.ts', agentId: 'a2' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const shown = async () => (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('row:'))
  const focus = async (n: number) => {
    await $.ui.focus({
      component: 'AbovePrompt',
      requestId: BAND.requestId,
      plugin: 'task-progress',
      element: `row:todo::${n}`,
      origin: { kind: 'person' },
    })
    await ui.redraw()
  }
  expect(await shown()).toEqual(['row:todo::0', 'row:todo::1', 'row:todo::2', 'row:todo::3', 'row:todo::4'])

  // Down to the last row and back up: the row the ring goes to next is always drawn
  for (const n of [4, 5, 6]) {
    await focus(n)
    expect(await shown()).toContain(`row:todo::${Math.min(n + 1, 6)}`)
  }
  for (const n of [5, 4, 3, 2, 1]) {
    await focus(n)
    expect(await shown()).toContain(`row:todo::${n - 1}`)
  }
  await ui.unmount()
})

test('a done task keeps the agent that worked on it, and Enter on it opens that agent', async ($, on) => {
  let status: 'running' | 'completed' = 'running'
  const views: (string | undefined)[] = []
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Build lexer', type: 'implementer', status }],
  }))
  on('ui.view', (_, e) => {
    views.push(e.agentId)
    return { value: {} }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  const todos = TODOS.slice(0, 4)
  await $.tool.call({ tool: 'TodoWrite', todos })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/lexer.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
  // a1 finishes; Build parser is marked done and the next todo started
  status = 'completed'
  await $.tool.call({
    tool: 'TodoWrite',
    todos: todos.map((t, i) => ({ ...t, status: i <= 1 ? ('completed' as const) : i === 2 ? ('in_progress' as const) : ('pending' as const) })),
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const row = async (key: string) => (await ui.find({ type: 'Button', key }))?.text ?? ''
  expect(await row('row:todo::1')).toContain('Build lexer')
  // A done task nobody was spawned for was the main conversation's
  expect(await row('row:todo::0')).toContain('main')
  // Its DOING is cleared: the agent is done
  expect(await row('row:todo::1')).not.toContain('Edit lexer.ts')

  await ui.press({ key: 'row:todo::1' })
  expect(views).toEqual(['a1'])
  await ui.unmount()
})

test('a MODEL column after AGENT names each agent\'s model and effort, shortened', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Build lexer', type: 'implementer', status: 'running' as const }],
  }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const step = async (model: string, effort: 'medium' | 'high' | undefined, agentId?: string) => {
    for await (const _ of $.turn.step({ turnId: 't', index: 0, model, effort, messageCount: 1, ...(agentId && { agentId }) })) {
      // drained
    }
  }

  await step('claude-opus-5-5', 'high')
  await $.tool.call({ tool: 'TodoWrite', todos: TODOS })
  await step('claude-haiku-5-5', 'medium', 'a1')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/lexer.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const header = (await ui.find({ type: 'Text', text: /TASK/ }))?.text ?? ''
  expect(header.indexOf('AGENT')).toBeLessThan(header.indexOf('MODEL'))
  expect(header.indexOf('MODEL')).toBeLessThan(header.indexOf('DOING'))
  const row = async (key: string) => (await ui.find({ type: 'Button', key }))?.text ?? ''
  expect(await row('row:todo::1')).toMatch(/Build lexer\s+haiku med\s+Edit lexer\.ts/)
  expect(await row('row:todo::0')).toMatch(/main\s+opus hi\s/)
  // Nobody at it yet: no model
  expect(await row('row:todo::2')).toMatch(/—\s+—\s+—/)
  // As small as it goes: the column is its widest value
  expect(header).toMatch(/MODEL {6}DOING/)
  await ui.unmount()
})

test('a finished plan is dismantled at the next prompt, its agents with it, while work still running stays', async ($, on) => {
  const files: Record<string, string> = {
    '/repo/.superpowers/plans/2026-01-01-export.md': PLAN,
    '/repo/.superpowers/sdd/2026-01-01-export/progress.md': `${LEDGER}Task 2: complete\nTask 3: complete\n`,
  }
  on('session.cwd', () => ({ value: '/repo' }))
  on('env.get', () => ({ value: '/home' }))
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', description: 'Implement Task 1: fixtures', type: 'general-purpose', status: 'completed' as const },
      { id: 'a2', description: 'Final whole-branch review', type: 'general-purpose', status: 'completed' as const },
      { id: 'a3', description: 'Research requests', type: 'Explore', status: 'running' as const },
    ],
  }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.tool.call({ tool: 'Bash', command: 'sed -n 1,80p .superpowers/plans/2026-01-01-export.md' })
  for (const agentId of ['a1', 'a2', 'a3']) await $.tool.call({ tool: 'Read', file_path: '/repo/x.ts', agentId })
  const keys = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isWorking: false } })
    const found = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row:')).map(b => b.key)
    await ui.unmount()
    return found
  }
  expect(await keys()).toEqual(['row:plan:1', 'row:plan:2', 'row:plan:3', 'row:agent:a2', 'row:agent:a3'])

  await $.prompt.submit({ text: 'what next?' })
  expect(await keys()).toEqual(['row:agent:a3'])
})

test('a new plan does not take on the agents of the one before it', async ($, on) => {
  const files: Record<string, string> = {
    '/repo/.superpowers/plans/2026-01-01-export.md': PLAN,
    '/repo/.superpowers/sdd/2026-01-01-export/progress.md': LEDGER,
    '/repo/.superpowers/plans/2026-01-02-import.md': '### Task 1: Import fixtures\n\n- [ ] **Step 1:** Write them\n\n### Task 2: Import command\n\n- [ ] **Step 1:** Write it\n',
    '/repo/.superpowers/sdd/2026-01-02-import/progress.md': 'Task 1: complete\n',
  }
  on('session.cwd', () => ({ value: '/repo' }))
  on('env.get', () => ({ value: '/home' }))
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Implement Task 1: fixtures', type: 'general-purpose', status: 'completed' as const }],
  }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.tool.call({ tool: 'Bash', command: 'sed -n 1,80p .superpowers/plans/2026-01-01-export.md' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/x.ts', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'sed -n 1,80p .superpowers/plans/2026-01-02-import.md' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const row = await ui.find({ type: 'Button', key: 'row:plan:1' })
  expect(row?.text).toContain('Import fixtures')
  expect(row?.text).not.toContain('Implement fixtures')
  await ui.unmount()
})

test('the hint names the chord the person bound to focus the band', async ($, on) => {
  const files: Record<string, string> = {}
  const clock = mock.clock(on)
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home' : undefined }))
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: TODOS })
  const hint = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const text = (await ui.find({ type: 'Text', text: / select/ }))?.text
    await ui.unmount()
    return text
  }
  expect(await hint()).toContain('ctrl+x tab select')

  files['/home/.claude/keybindings.json'] = JSON.stringify({
    bindings: [{ context: 'Chat', bindings: { 'ctrl+x tab': null, 'ctrl+up': 'abovePrompt:focus' } }],
  })
  await clock.advance(10_000)
  expect(await hint()).toContain('ctrl+up select')
  expect(await hint()).not.toContain('ctrl+x tab')
})
