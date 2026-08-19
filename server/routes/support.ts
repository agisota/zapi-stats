import { Hono } from 'hono';
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

interface SupportPayload {
  message?: string;
  contact?: string;
  contactType?: string;
  voiceNote?: string;
}

export function supportRoutes() {
  const app = new Hono();

  app.post('/support/transcribe', async (c) => {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      return c.json({ error: { code: 'TRANSCRIPTION_DISABLED', message: 'Транскрипция временно не настроена.' } }, 503);
    }

    const body = await c.req.parseBody().catch(() => null);
    const audio = body?.audio;
    if (!(audio instanceof File)) {
      return c.json({ error: { code: 'AUDIO_REQUIRED', message: 'Не найден аудиофайл для расшифровки.' } }, 400);
    }
    if (audio.size > 25 * 1024 * 1024) {
      return c.json({ error: { code: 'AUDIO_TOO_LARGE', message: 'Голосовое сообщение больше 25 MB.' } }, 413);
    }

    const form = new FormData();
    form.set('file', audio, audio.name || 'support-voice.webm');
    form.set('model', process.env.GROQ_TRANSCRIPTION_MODEL ?? 'whisper-large-v3-turbo');
    form.set('response_format', 'json');
    form.set('temperature', '0');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('Groq transcription failed', { status: response.status, detail: detail.slice(0, 300) });
      return c.json({ error: { code: 'TRANSCRIPTION_FAILED', message: 'Не удалось расшифровать голосовое сообщение.' } }, 502);
    }

    const result = await response.json().catch(() => ({})) as { text?: string };
    const text = result.text?.trim() ?? '';
    if (!text) {
      return c.json({ error: { code: 'EMPTY_TRANSCRIPT', message: 'Модель не вернула текст расшифровки.' } }, 502);
    }

    return c.json({ data: { text, model: process.env.GROQ_TRANSCRIPTION_MODEL ?? 'whisper-large-v3-turbo' } });
  });

  app.post('/support/requests', async (c) => {
    const payload = await c.req.json().catch(() => null) as SupportPayload | null;
    const message = payload?.message?.trim() ?? '';
    const contact = payload?.contact?.trim() ?? '';
    const contactType = payload?.contactType === 'email' ? 'email' : 'telegram';
    const voiceNote = payload?.voiceNote?.trim() ?? '';

    if (!message && !voiceNote) {
      return c.json({ error: { code: 'EMPTY_REQUEST', message: 'Опишите проблему или приложите голосовое сообщение.' } }, 400);
    }
    if (!contact) {
      return c.json({ error: { code: 'CONTACT_REQUIRED', message: 'Укажите Telegram или рабочую почту для ответа.' } }, 400);
    }

    const stateDir = process.env.APP_STATE_DIR ?? '/data/zapi-stats-state';
    await mkdir(stateDir, { recursive: true });
    const item = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      contact,
      contactType,
      message,
      hasVoiceNote: Boolean(voiceNote),
      voiceNote,
      userAgent: c.req.header('user-agent') ?? null,
    };
    await appendFile(join(stateDir, 'support-requests.jsonl'), `${JSON.stringify(item)}\n`);

    // Notify via Telegram
    const tgToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const tgChatId = process.env.TELEGRAM_CHAT_ID?.trim();
    if (tgToken && tgChatId) {
      const tgText = [
        `📩 Новая заявка #${item.id.slice(0, 8)}`,
        `От: ${item.contact} (${item.contactType})`,
        item.message ? `Сообщение: ${item.message.slice(0, 800)}` : '',
        item.voiceNote ? `🎤 Расшифровка: ${item.voiceNote.slice(0, 400)}` : '',
        `🕐 ${item.createdAt}`,
      ].filter(Boolean).join('\n');
      try {
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tgChatId, text: tgText, parse_mode: 'HTML', disable_web_page_preview: true }),
        });
      } catch {
        console.error('Telegram notify failed');
      }
    }

    return c.json({ data: { id: item.id, createdAt: item.createdAt, status: 'received' } });
  });

  return app;
}
