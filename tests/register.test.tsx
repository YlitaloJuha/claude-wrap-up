import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionStartInput, TurnCompleteInput } from 'claude-code'

import { AGENT_MESSAGE, CHECKLIST, TURN_NOTICE } from '../hooks/register'

const session: SessionStartInput = { surface: 'desktop', isInteractive: true, cwd: '/work' }

type AnsweredTurn = Exclude<TurnCompleteInput, { reason: 'refusal' }>
let turns = 0
const turn = (over: Partial<AnsweredTurn> = {}): TurnCompleteInput => ({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't' + ++turns, reason: 'answer', ...over })

function world(on: On, list: Array<{ id: string; status: string }> = [], count = 3) {
  const sent: Array<{ to: unknown; text: string }> = []
  const prompts: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('session.turns', () => ({ value: count }))
  on('agent.list', () => ({ value: list as never }))
  on('session.send', ($, e) => { sent.push({ to: e.to, text: e.text }); return { isDelivered: true } })
  on('prompt.submit', ($, e) => { prompts.push(e.text); return { text: e.text } })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: ['beneath'] }))
  return { sent, prompts }
}

test('the checklist does docs and handoffs before commits, and never commits or pushes unasked', () => {
  expect(CHECKLIST.indexOf('Docs.')).toBeLessThan(CHECKLIST.indexOf('Commits.'))
  expect(CHECKLIST.indexOf('Handoffs')).toBeLessThan(CHECKLIST.indexOf('Commits.'))
  expect(CHECKLIST).toContain('Ask before committing, then ask before pushing')
})

const press = ($: Parameters<Parameters<typeof test>[1]>[0]) => $.command.run({ command: 'wrap-up' })
const starting = ($: Parameters<Parameters<typeof test>[1]>[0]) => $.turn.start({ text: 'working', turnId: 'running' } as never)

test('a press tells live agents only and queues the checklist once', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, [{ id: 'A1', status: 'running' }, { id: 'A2', status: 'completed' }, { id: 'A3', status: 'waiting' }])
  await $.session.start(session)
  await press($)
  await press($)
  await clock.advance(5)
  expect(w.sent.map(s => s.text)).toEqual([AGENT_MESSAGE, AGENT_MESSAGE])
  expect(w.prompts).toEqual([CHECKLIST])
})

test('it can run again once the checklist turn ends', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  await $.session.start(session)
  await press($)
  await clock.advance(5)
  await $.turn.complete(turn({ agentId: 'A1' } as never))
  await press($)
  await clock.advance(5)
  expect(w.prompts.length).toBe(1)
  await $.turn.complete(turn())
  await press($)
  await clock.advance(5)
  expect(w.prompts.length).toBe(2)
})

test('a press during a turn waits for that turn and then the checklist turn', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  await $.session.start(session)
  await starting($)
  await press($)
  await clock.advance(5)
  await $.turn.complete(turn())
  await press($)
  await clock.advance(5)
  expect(w.prompts.length).toBe(1)
  await $.turn.complete(turn())
  await press($)
  await clock.advance(5)
  expect(w.prompts.length).toBe(2)
})

test('a running turn hears it once, on its next tool result, and a subagent call does not use it up', async ($, on) => {
  mock.clock(on)
  world(on)
  await $.session.start(session)
  await starting($)
  await press($)
  const sub = await $.tool.call({ tool: 'Read', file_path: 'a', agentId: 'A1' } as never)
  expect(sub.context).toBeUndefined()
  const first = await $.tool.call({ tool: 'Read', file_path: 'b' } as never)
  expect(first.context).toEqual([TURN_NOTICE])
  const second = await $.tool.call({ tool: 'Read', file_path: 'c' } as never)
  expect(second.context).toBeUndefined()
})

test('an idle press adds nothing to tool results', async ($, on) => {
  mock.clock(on)
  world(on)
  await $.session.start(session)
  await press($)
  const result = await $.tool.call({ tool: 'Read', file_path: 'b' } as never)
  expect(result.context).toBeUndefined()
})
