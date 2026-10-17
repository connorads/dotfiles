import type { Command, Kind, Reply } from '../../../src/bb-plugins/handsfree/contracts.ts'
import { matchBb, runBb, type BbPorts } from './bb.ts'

type Speech = { command: Command } | { kind: Kind; target: string } | { error: string }
const fixed: Record<string, Command> = {
  'focus chat': { action: 'focus' }, 'focus message': { action: 'focus' }, 'focus composer': { action: 'focus' },
  'next thread': { action: 'next' }, 'next conversation': { action: 'next' },
  'previous thread': { action: 'previous' }, 'previous conversation': { action: 'previous' },
  'next unread': { action: 'unread' }, 'who needs me': { action: 'attention' }, 'next waiting': { action: 'attention' },
  'next finished': { action: 'finished' }, 'show git': { action: 'show', view: 'git' },
  'show usage': { action: 'show', view: 'usage' }, 'close popup': { action: 'dismiss' },
  'close pop up': { action: 'dismiss' }, 'close voice monitor': { action: 'dismiss' },
  'new thread': { action: 'new' }, 'voice help': { action: 'help' },
  'voice monitor': { action: 'monitor' }, 'voice history': { action: 'monitor' }, 'show voice': { action: 'monitor' },
  'archive this thread': { action: 'archive' }, 'archive thread': { action: 'archive' },
  'confirm archive': { action: 'confirm-archive' }, 'cancel archive': { action: 'cancel-archive' },
  'unarchive last thread': { action: 'restore' }, 'restore last thread': { action: 'restore' },
  'allow once': { action: 'approve', decision: 'allow_once' },
  'allow for session': { action: 'approve', decision: 'allow_for_session' },
  'deny approval': { action: 'approve', decision: 'deny' },
}
export function parseSpeech(transcript: string): Speech {
  const text = transcript.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (fixed[text]) return { command: fixed[text] }
  if (text === 'show threads') return { kind: 'thread', target: '' }
  if (text === 'show projects' || text === 'list projects') return { kind: 'project', target: '' }
  const digit = text.match(/^choose (one|two|three|four|five|six|seven|eight|nine|[1-9])$/)?.[1]
  if (digit) return { command: { action: 'choose', number: Number(digit) || ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].indexOf(digit) + 1 } }
  for (const [prefix, kind] of [['new thread in ', 'project'], ['select project ', 'project'], ['switch project to ', 'project'], ['use ', 'model'], ['go to ', 'thread'], ['take me to ', 'thread'], ['can i go to ', 'thread']] as const) {
    if (text.startsWith(prefix) && text.length > prefix.length) {
      const target = text.slice(prefix.length)
      const navigation = target.replace(/^the /, '')
      if (kind === 'thread' && (navigation === 'next thread' || navigation === 'previous thread')) return { command: { action: navigation === 'next thread' ? 'next' : 'previous' } }
      return { kind, target }
    }
  }
  return { error: `Unrecognised command: “${transcript}”. Say “voice help” for commands.` }
}
export async function runSpeech(ports: BbPorts, transcript: string, choiceTarget?: string): Promise<Reply> {
  const speech = parseSpeech(transcript)
  await runBb(ports, { action: 'notice', message: `Heard: “${transcript}”.` })
  if ('error' in speech) return runBb(ports, { action: 'notice', message: speech.error, problem: true })
  if ('command' in speech) {
    const command = speech.command.action === 'choose' && choiceTarget !== undefined
      ? { ...speech.command, target: choiceTarget } : speech.command
    return runBb(ports, command)
  }
  return matchBb(ports, speech.kind, speech.target, { choose: true })
}
