// Клиент живёт на /new, его серверная часть — сервис prototype-api на /new/api (Caddy или прокси Vite).
export const API_BASE = '/new/api'

export function apiUrl(path: string) {
  return `${API_BASE}${path}`
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function requestJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new HttpError(response.status, body?.error ?? response.statusText)
  }
  return (await response.json()) as T
}
