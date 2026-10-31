import { fetchServerSentEvents, useChat } from '@tanstack/ai-react'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { useTranslation } from '@/shared/i18n'
import { Button } from '@/shared/ui/components/button'
import { Textarea } from '@/shared/ui/components/textarea'

export const Route = createFileRoute('/_authenticated/applicant/assistant')({
  component: Assistant,
})

function Assistant() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [threadId] = useState(() => crypto.randomUUID())
  const { messages, sendMessage, isLoading, error, stop } = useChat({
    connection: fetchServerSentEvents('/api/chat'),
    threadId,
  })

  const send = () => {
    const text = input.trim()
    if (!text) return
    void sendMessage(text)
    setInput('')
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <div className="flex flex-1 flex-col gap-3">
        {messages.map(message => (
          <div
            key={message.id}
            className={
              message.role === 'user'
                ? 'self-end rounded-lg bg-primary px-3 py-2 text-primary-foreground'
                : 'self-start rounded-lg bg-muted px-3 py-2'
            }
          >
            {message.parts.map((part, index) =>
              part.type === 'text' ? (
                <p key={index} className="whitespace-pre-wrap">
                  {part.content}
                </p>
              ) : null,
            )}
          </div>
        ))}
      </div>
      {error && <p className="text-destructive">{error.message}</p>}
      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault()
          send()
        }}
      >
        <Textarea
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          placeholder={t('chat.placeholder')}
        />
        {isLoading ? (
          <Button type="button" variant="outline" onClick={stop}>
            {t('chat.stop')}
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim()}>
            {t('chat.send')}
          </Button>
        )}
      </form>
    </main>
  )
}
