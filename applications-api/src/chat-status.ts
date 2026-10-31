// Общий кеш не даёт каждой открытой вкладке отдельно опрашивать GigaChat.
interface ChatStatus {
  available: boolean
  model: string | null
  message: string
}
let cached: { value: ChatStatus; expires: number } | undefined
let pending: Promise<ChatStatus> | undefined

export async function chatStatus(chatUrl: string): Promise<ChatStatus> {
  if (cached && cached.expires > Date.now()) return cached.value
  if (pending) return pending
  pending = (async () => {
    let value: ChatStatus
    try {
      const response = await fetch(`${chatUrl}/chat/health`, { signal: AbortSignal.timeout(45000) })
      if (!response.ok) throw new Error('chat_unavailable')
      const data = await response.json() as { llm?: { available?: boolean; model?: string; error?: string } }
      const available = data.llm?.available === true
      value = {
        available,
        model: available ? data.llm?.model ?? null : null,
        message: available ? 'Подключение к GigaChat установлено'
          : data.llm?.error?.includes('Не задан') ? 'Подключение к GigaChat не настроено' : 'GigaChat временно недоступен',
      }
    } catch {
      value = { available: false, model: null, message: 'Сервис GigaChat не отвечает' }
    }
    cached = { value, expires: Date.now() + 30000 }
    return value
  })()
  try { return await pending } finally { pending = undefined }
}
