import { expect, test } from 'bun:test'
import { parseSpeech, runSpeech } from './speech.ts'
import { matchBb, type BbPorts } from './bb.ts'
import { ok } from './pane.ts'
import type { Command } from '../../../src/bb-plugins/handsfree/contracts.ts'

test('dictated punctuation and supported command aliases use existing BB actions', () => {
  expect(parseSpeech('Next thread.')).toEqual({ command: { action: 'next' } })
  expect(parseSpeech('Go to the next thread!')).toEqual({ command: { action: 'next' } })
  expect(parseSpeech('Choose two.')).toEqual({ command: { action: 'choose', number: 2 } })
  expect(parseSpeech('New thread in KB')).toEqual({ kind: 'project', target: 'kb' })
  expect(parseSpeech('please delete everything')).toHaveProperty('error')
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
