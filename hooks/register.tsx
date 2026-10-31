// Wrap up, from the bars mod's button or /wrap-up. It tells running subagents to finish,
// tells a running turn through its next tool result, and queues the checklist
// as a prompt of its own, which runs once the session is idle.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Phase } from '../types'

const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])

export const AGENT_MESSAGE =
  'The user pressed Wrap up. Finish the step you are on, start nothing new, and report what you did and what is left.'

export const TURN_NOTICE =
  'The user pressed the Wrap up button. Finish the step you are on and start nothing new. ' +
  'End this turn at the next suitable moment; the wrap-up checklist follows as its own message.'

export const CHECKLIST = `The user pressed the Wrap up button. Close this session out cleanly, in this order:

1. Stop. Start no new work, and finish only the step in progress. Running subagents have been told the same: wait for them and read what they report. Stop background processes you started that are no longer needed.
2. Verify. Run the checks that fit what changed and report the real results. List new problems instead of fixing them.
3. Docs. Bring up to date what this work changed: the project's CLAUDE.md, its docs and memory.
4. Handoffs and tracking. Update whatever tracks progress here (plan files, task lists, issues, pull requests, spec tools). For anything unfinished, leave a handoff a fresh session can start from, and report to any session waiting on this one.
5. Commits. In each repository this session touched, check for uncommitted work and unpushed commits. Show what you find. Ask before committing, then ask before pushing. Do neither without a yes to that question.
6. Report. Say briefly what is done, what is not, where it was committed, and the next step.

Skip a step that does not apply and say so.`

const phase = atom({ plugin: 'wrap-up', key: 'phase' } as const, 'idle' as Phase)
const isNoticeDue = atom({ plugin: 'wrap-up', key: 'isNoticeDue' } as const, false)
const turnsBeforeChecklist = atom({ plugin: 'wrap-up', key: 'turnsBeforeChecklist' } as const, 0)

let isWorking = false

async function wrapUp($: EngineInterface) {
  if ((await read($, phase)) !== 'idle') return
  await update($, phase, () => 'asked')
  await update($, isNoticeDue, () => isWorking)
  await update($, turnsBeforeChecklist, () => (isWorking ? 1 : 0))
  const live = (await $.agent.list()).filter(a => LIVE.has(a.status))
  const sent = await Promise.all(
    live.map(a => $.session.send({ to: { agentId: a.id }, text: AGENT_MESSAGE }).then(r => r.isDelivered, () => false)),
  )
  const told = sent.filter(Boolean).length
  if (live.length > 0) $.ui.toast(`Wrap up: told ${told} of ${live.length} subagents`)
  // Work a press starts ends with the press; a timer gives the prompt its own dispatch.
  $.clock.after(1, () => $.prompt.submit({ text: CHECKLIST }))
}

export const register: Register = on => {
  // Adds `$.wrapUp`, which the bars mod's button calls. A call is the `wrapUp.start`
  // event, answered below; the method itself is the chain's floor.
  on('engine.create', async ($, e, next) => {
    const built = await next(e)
    return { ...built, wrapUp: { start: async () => undefined } }
  })

  on('wrapUp.start', async $ => ({ value: await wrapUp($) }))

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'wrap-up', description: 'Stop at a suitable moment, then check docs, handoffs, commits and pushes', immediate: true })
    return result
  })

  on('command.run', { command: 'wrap-up' }, async $ => {
    await wrapUp($)
    return { text: 'Wrapping up' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) isWorking = true
    return next(e)
  })

  // Reaches a turn already running, which a queued prompt would only follow.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || result.deny !== undefined || !(await read($, isNoticeDue))) return result
    await update($, isNoticeDue, () => false)
    return { ...result, context: [...(result.context ?? []), TURN_NOTICE] }
  })

  // The turn running at the press ends first; the checklist's own turn ends next.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) isWorking = false
    if (e.agentId !== undefined || (await read($, phase)) === 'idle') return result
    await update($, isNoticeDue, () => false)
    if ((await read($, turnsBeforeChecklist)) > 0) await update($, turnsBeforeChecklist, n => n - 1)
    else await update($, phase, () => 'idle')
    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await update($, phase, () => 'idle')
    return next(e)
  })

  // The bars mod holds this button on its line; without it, this draws its own.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey || (await $.command.list()).some(c => c.name === 'bars')) return rest
    const state = await read($, phase)
    if (state === 'idle' && !e.props.isWorking && (await $.session.turns()) === 0) return rest
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="row" justifyContent="flex-end">
          {state === 'idle'
            ? <Button key="wrap-up" label="Wrap up" plain dimColor onPress={() => wrapUp($)} />
            : <Text dimColor>Wrapping up</Text>}
        </Box>
      </Box>
    )
  })
}
