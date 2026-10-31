import { openRouterText } from '@tanstack/ai-openrouter'

type TextModel = Parameters<typeof openRouterText>[0]

export function textAdapter() {
  const model = process.env.OPENROUTER_MODEL ?? 'google/gemma-4-26b-a4b-it'
  return openRouterText(model as TextModel)
}
