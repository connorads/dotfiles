import { z } from 'zod';

export const kindSchema = z.enum(['thread', 'project', 'model']);
export const candidateSchema = z.object({
  id: z.string().min(1).max(512),
  label: z.string().min(1).max(1024),
  title: z.string().min(1).max(1024).optional(),
  project: z.string().max(1024).optional(),
});
export const decisionSchema = z.enum(['allow_once', 'allow_for_session', 'deny']);
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('capture') }).strict(),
  z.object({ action: z.literal('list'), kind: kindSchema }).strict(),
  z.object({ action: z.literal('select'), kind: kindSchema, id: z.string().min(1).max(512), context: z.string() }).strict(),
  z.object({ action: z.literal('choices'), kind: kindSchema, options: z.array(candidateSchema).min(1).max(9), context: z.string(), message: z.string().max(1024) }).strict(),
  z.object({ action: z.literal('choose'), number: z.number().int().min(1).max(9), target: z.string().min(1).max(512).optional() }).strict(),
  z.object({ action: z.literal('next') }).strict(),
  z.object({ action: z.literal('previous') }).strict(),
  z.object({ action: z.literal('attention') }).strict(),
  z.object({ action: z.literal('finished') }).strict(),
  z.object({ action: z.literal('unread') }).strict(),
  z.object({ action: z.literal('show'), view: z.enum(['git', 'usage']) }).strict(),
  z.object({ action: z.literal('dismiss') }).strict(),
  z.object({ action: z.literal('new') }).strict(),
  z.object({ action: z.literal('help') }).strict(),
  z.object({ action: z.literal('monitor') }).strict(),
  z.object({ action: z.literal('archive') }).strict(),
  z.object({ action: z.literal('confirm-archive') }).strict(),
  z.object({ action: z.literal('cancel-archive') }).strict(),
  z.object({ action: z.literal('restore') }).strict(),
  z.object({ action: z.literal('approve'), decision: decisionSchema }).strict(),
  z.object({ action: z.literal('notice'), message: z.string().max(1024), problem: z.boolean().optional() }).strict(),
]);
export const replySchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  outcome: z.enum(['completed', 'choices', 'confirmation', 'archived', 'restored', 'cancelled', 'empty', 'partial', 'requested', 'no-match', 'error']).optional(),
  requestId: z.string().optional(),
  candidates: z.array(candidateSchema).optional(),
  context: z.string().optional(),
  choiceTarget: z.string().optional(),
  press: z.object({ key: z.string(), modifiers: z.array(z.enum(['command', 'control', 'option', 'shift'])) }).optional(),
});
export const requestSchema = z.object({ requestId: z.string(), command: commandSchema });
export type Command = z.infer<typeof commandSchema>;
export type Reply = z.infer<typeof replySchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type Kind = z.infer<typeof kindSchema>;
