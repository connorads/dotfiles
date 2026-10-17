import { expect, test } from 'bun:test'
import { parseSpeech, runSpeech } from './speech.ts'
import { matchBb, parseReply, type BbPorts } from './bb.ts'
import { ok } from './pane.ts'
import { commandSchema, type Command } from '../../../src/bb-plugins/handsfree/contracts.ts'

test('dictated punctuation and supported command aliases use existing BB actions', () => {
  expect(parseSpeech('Next thread.')).toEqual({ command: { action: 'next' } })
  expect(parseSpeech('Go to the next thread!')).toEqual({ command: { action: 'next' } })
  expect(parseSpeech('Choose two.')).toEqual({ command: { action: 'choose', number: 2 } })
  expect(parseSpeech('New thread in KB')).toEqual({ kind: 'project', target: 'kb' })
  expect(parseSpeech('please delete everything')).toHaveProperty('error')
})
test('focus aliases reach the same BB action', () => {
  for (const phrase of ['Focus chat.', 'Focus message', 'Focus composer']) {
    expect(parseSpeech(phrase)).toEqual({ command: { action: 'focus' } })
  }
})

test('natural draft and model phrases reach the existing actions', () => {
  for (const phrase of ['Create new thread.', 'Start new thread', 'Create a new thread', 'Start a new thread']) {
    expect(parseSpeech(phrase)).toEqual({ command: { action: 'new' } })
    expect(parseSpeech(`${phrase.replace('.', '')} in KB`)).toEqual({ kind: 'project', target: 'kb' })
  }
  for (const phrase of ['Change model.', 'Show models', 'List models', 'Switch model']) {
    expect(parseSpeech(phrase)).toEqual({ kind: 'model', target: '' })
  }
  for (const phrase of ['Change model to Sonnet', 'Switch model to Sonnet']) {
    expect(parseSpeech(phrase)).toEqual({ kind: 'model', target: 'sonnet' })
  }
  expect(parseSpeech('What can I say here?')).toEqual({ command: { action: 'help' } })
})
test('approval phrases answer with exact decisions only', () => {
  expect(parseSpeech('Allow once.')).toEqual({ command: { action: 'approve', decision: 'allow_once' } })
  expect(parseSpeech('Allow for session')).toEqual({ command: { action: 'approve', decision: 'allow_for_session' } })
  expect(parseSpeech('Deny approval')).toEqual({ command: { action: 'approve', decision: 'deny' } })
  expect(parseSpeech('allow')).toHaveProperty('error')
})

test('account and favourite commands remain separate from model searches', () => {
  expect(parseSpeech('Use account work.')).toEqual({ kind: 'account', target: 'work' })
  expect(parseSpeech('Switch account to work')).toEqual({ kind: 'account', target: 'work' })
  expect(parseSpeech('Show accounts')).toEqual({ kind: 'account', target: '' })
  expect(parseSpeech('Show favourites')).toEqual({ kind: 'favourite', target: '' })
  expect(parseSpeech('Use favourite two')).toEqual({ kind: 'favourite', target: '2' })
  expect(parseSpeech('Use favorite 9')).toEqual({ kind: 'favourite', target: '9' })
})
test('pedal search offers even a unique literal match without navigating', async () => {
  const commands: Command[] = []
  const ports: BbPorts = {
    request: async command => { commands.push(command); return command.action === 'list' ? { ok: true, message: '', context: 'test', candidates: [{ id: 'hex', label: 'Hex', title: 'Hex' }] } : { ok: true, message: '' } },
    judge: async () => ok({ choice: 'none', confidence: 1, probabilities: { none: 1 } }), notify: async () => {}, log: async () => {},
  }
  await runSpeech(ports, 'Go to the Hex thread.')
  expect(commands.at(-1)).toMatchObject({ action: 'choices', options: [{ id: 'hex' }] })
  expect(commands.some(command => command.action === 'select')).toBe(false)
  commands.length = 0
  await matchBb(ports, 'thread', 'hex')
  expect(commands.at(-1)).toMatchObject({ action: 'select', id: 'hex' })
})

test('every registered BB command phrase is accepted by the pedal parser', async () => {
  const { default: config } = await import('../hex.config.ts')
  for (const [id, command] of Object.entries(config.commands)) {
    if (!id.startsWith('bb-')) continue
    for (const phrase of command.phrases) {
      const spoken = phrase.replace('{n}', 'two').replace(/\{[^}]+\}/g, 'example')
      expect(parseSpeech(spoken), `${id}: ${spoken}`).not.toHaveProperty('error')
    }
  }
})

test('recorded choices keep their captured target through recognition feedback', async () => {
  const commands: Command[] = []
  const ports: BbPorts = {
    request: async command => { commands.push(command); return { ok: true, message: '' } },
    judge: async () => ok({ choice: 'none', confidence: 1, probabilities: { none: 1 } }), notify: async () => {}, log: async () => {},
  }
  await runSpeech(ports, 'Choose two.', 'recording-target')
  expect(commands).toEqual([
    { action: 'notice', message: 'Heard: “Choose two.”.' },
    { action: 'choose', number: 2, target: 'recording-target' },
  ])
  commands.length = 0
  await runSpeech(ports, 'Choose 1')
  expect(commands.at(-1)).toEqual({ action: 'choose', number: 1 })
  commands.length = 0
  await runSpeech(ports, 'Next thread.', 'recording-target')
  expect(commands.at(-1)).toEqual({ action: 'next' })
})

test('capture replies retain the target through the command bridge', () => {
  const reply = parseReply({ ok: true, message: 'Command target captured.', context: 'thread-context', choiceTarget: 'recording-target' })
  expect(reply.choiceTarget).toBe('recording-target')
  expect(commandSchema.parse({ action: 'capture' })).toEqual({ action: 'capture' })
  expect(commandSchema.parse({ action: 'choose', number: 2, target: reply.choiceTarget })).toEqual({ action: 'choose', number: 2, target: 'recording-target' })
})
