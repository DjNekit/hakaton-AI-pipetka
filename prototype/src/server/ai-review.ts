import type {
  AiReview,
  AiReviewItem,
  AiVerdict,
  DocumentType,
} from '@/entities/application/model'

import {
  getApplication,
  readApplicationFile,
  setAiReview,
} from './applications'
import { CHECKLIST_SECTIONS } from './checklist'

type SectionKey = keyof typeof CHECKLIST_SECTIONS

const SECTIONS_BY_TYPE: Record<DocumentType, SectionKey[]> = {
  passport: ['intake', 'passport'],
  signage: ['intake', 'signage'],
  facade: ['intake', 'special', 'facade'],
}

const FAKE_DELAY_MS = 4000
const NEGATIVE =
  /нарушение есть|есть нарушения|^нет$|не соответствует|неполное|не получены|не проведено|не учтено|есть основания|не укладывается/i

export interface ChecklistItem {
  id: string
  section: string
  title: string
  check: string
  basis: string
  options: readonly string[]
}

export function checklistFor(type: DocumentType): ChecklistItem[] {
  return SECTIONS_BY_TYPE[type].flatMap(key =>
    CHECKLIST_SECTIONS[key].items.map(item => ({
      ...item,
      section: CHECKLIST_SECTIONS[key].title,
    })),
  )
}

function seeded(seed: string) {
  let hash = 2166136261
  for (const char of seed) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return (hash >>> 0) / 4294967296
}

function pickVerdict(roll: number): AiVerdict {
  if (roll < 0.15) return 'violation'
  if (roll < 0.65) return 'ok'
  if (roll < 0.8) return 'not_applicable'
  return 'unknown'
}

function pickResult(item: ChecklistItem, verdict: AiVerdict) {
  const negative = item.options.find(option => NEGATIVE.test(option))
  const positive = item.options.find(option => !NEGATIVE.test(option))
  if (verdict === 'violation') return negative ?? 'Не соответствует'
  if (verdict === 'ok') return positive ?? 'Соответствует'
  if (verdict === 'not_applicable') {
    return (
      item.options.find(option => /не применимо/i.test(option)) ??
      'Не применимо'
    )
  }
  return 'Не определить'
}

const COMMENTS: Record<AiVerdict, string> = {
  violation:
    'Демо: в документе не найдено подтверждение по этому пункту. Проверьте вручную.',
  ok: 'Демо: требование выглядит выполненным.',
  not_applicable: 'Демо: пункт не относится к этой заявке.',
  unknown: 'Демо: по тексту документа это не проверить.',
}

function fakeReview(applicationId: string, checklist: ChecklistItem[]) {
  const items: AiReviewItem[] = checklist.map(item => {
    const rolled = pickVerdict(seeded(`${applicationId}:${item.id}`))
    const canViolate =
      item.options.length === 0 ||
      item.options.some(option => NEGATIVE.test(option))
    const verdict = rolled === 'violation' && !canViolate ? 'ok' : rolled
    return {
      id: item.id,
      section: item.section,
      title: item.title,
      basis: item.basis,
      verdict,
      result: pickResult(item, verdict),
      comment: COMMENTS[verdict],
    }
  })
  const violations = items.filter(item => item.verdict === 'violation')
  const unknown = items.filter(item => item.verdict === 'unknown')
  const summary = violations.length
    ? `Найдено замечаний: ${violations.length} из ${items.length}. Не удалось проверить: ${unknown.length}.`
    : `Замечаний не найдено. Не удалось проверить: ${unknown.length} из ${items.length}.`
  return { items, summary }
}

export async function runAiReview(id: string) {
  const application = getApplication(id)
  if (!application || !readApplicationFile(id)) return
  const base: AiReview = { state: 'running', summary: '', items: [] }
  setAiReview(id, base)
  try {
    await new Promise(resolve => setTimeout(resolve, FAKE_DELAY_MS))
    const { items, summary } = fakeReview(
      id,
      checklistFor(application.documentType),
    )
    setAiReview(
      id,
      {
        state: 'done',
        summary,
        items,
        model: 'demo',
        finishedAt: new Date().toISOString(),
      },
      'in_review',
    )
  } catch (error) {
    setAiReview(
      id,
      {
        ...base,
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      },
      'in_review',
    )
  }
}
