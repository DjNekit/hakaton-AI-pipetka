// Общий кеш не даёт каждой открытой вкладке отдельно опрашивать GigaChat.
interface ChatStatus {
  available: boolean
  reachable: boolean
  checkedAt: string
  model: string | null
  message: string
}
let cached: { value: ChatStatus; expires: number } | undefined
let pending: Promise<ChatStatus> | undefined

export async function chatStatus(chatUrl: string, refresh = false): Promise<ChatStatus> {
  if (!refresh && cached && cached.expires > Date.now()) return cached.value
  if (pending) return pending
  pending = (async () => {
    let value: ChatStatus
    try {
      const response = await fetch(`${chatUrl}/chat/health`, { signal: AbortSignal.timeout(45000) })
      if (!response.ok) throw new Error('chat_unavailable')
      const data = await response.json() as { llm?: { available?: boolean; model?: string; error?: string } }
      if (typeof data.llm?.available !== 'boolean') throw new Error('invalid_status')
      const available = data.llm.available === true
      value = {
        available,
        reachable: true,
        checkedAt: new Date().toISOString(),
        model: available ? data.llm?.model ?? null : null,
        message: available ? 'Подключение к GigaChat установлено'
          : data.llm?.error?.includes('Не задан') ? 'Подключение к GigaChat не настроено'
          : /HTTP 429/.test(data.llm?.error ?? '') ? 'GigaChat временно ограничил частоту запросов'
          : /HTTP (401|403)/.test(data.llm?.error ?? '') ? 'Ошибка авторизации в GigaChat'
          : /сертификат|certificate/i.test(data.llm?.error ?? '') ? 'Ошибка сертификата подключения к GigaChat'
          : 'GigaChat временно недоступен',
      }
    } catch {
      value = { available: false, reachable: false, checkedAt: new Date().toISOString(), model: null, message: 'Не удалось связаться с сервисом проверки подключения' }
    }
    cached = { value, expires: Date.now() + (value.available ? 30000 : 5000) }
    return value
  })()
  try { return await pending } finally { pending = undefined }
}
