export async function sendTelegramMessage(input: {
  botToken?: string | null
  chatId?: string | null
  text: string
  parseMode?: 'Markdown' | 'HTML' | 'none'
}) {
  if (!input.botToken || !input.chatId) {
    return { delivered: false, reason: 'telegram not configured' as const }
  }

  const body: Record<string, unknown> = {
    chat_id: input.chatId,
    text: input.text,
    disable_web_page_preview: true,
  }

  const parseMode = input.parseMode ?? 'Markdown'
  if (parseMode !== 'none') {
    body.parse_mode = parseMode
  }

  const timeoutMs = Math.max(1_000, Math.min(Number(process.env.TELEGRAM_SEND_TIMEOUT_MS ?? 8_000), 30_000))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(
      `https://api.telegram.org/bot${input.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Telegram send failed: ${body}`)
  }

  return { delivered: true as const }
}
