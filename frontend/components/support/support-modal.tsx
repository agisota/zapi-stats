import { useMemo, useRef, useState } from 'react';
import { Check, Loader2, Mail, Mic, Send, Square, X } from 'lucide-react';
import { submitSupportRequest, transcribeSupportAudio } from '../../lib/api.ts';

export function SupportModal({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [contactType, setContactType] = useState<'telegram' | 'email'>('telegram');
  const [voiceNote, setVoiceNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'recording' | 'transcribing' | 'done' | 'error'>('idle');
  const [recordingMs, setRecordingMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const canSend = useMemo(() => Boolean(contact.trim()) && Boolean(message.trim() || voiceNote.trim()), [contact, message, voiceNote]);

  async function startRecording() {
    if (voiceStatus === 'recording') return;
    setVoiceStatus('idle');
    setRecordingMs(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        void transcribeRecording(recorder.mimeType || 'audio/webm');
      };
      recorder.start();
      setVoiceStatus('recording');
      const started = Date.now();
      timerRef.current = window.setInterval(() => setRecordingMs(Date.now() - started), 250);
    } catch {
      setVoiceStatus('error');
      setVoiceNote('Браузер не дал доступ к микрофону. Проверьте разрешения и попробуйте снова.');
    }
  }

  function stopRecording() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      setVoiceStatus('transcribing');
      recorder.stop();
    }
  }

  async function transcribeRecording(mimeType: string) {
    try {
      const audio = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
      if (audio.size < 1024) throw new Error('empty recording');
      const result = await transcribeSupportAudio(audio);
      const text = result.data.text.trim();
      setVoiceNote(text);
      setMessage(prev => prev.trim() ? `${prev.trim()}\n\nГолосовая расшифровка: ${text}` : text);
      setVoiceStatus('done');
    } catch {
      setVoiceStatus('error');
      setVoiceNote('Не удалось автоматически расшифровать запись. Можно описать проблему текстом.');
    } finally {
      recorderRef.current = null;
      chunksRef.current = [];
    }
  }

  async function submit() {
    if (!canSend || status === 'sending') return;
    setStatus('sending');
    try {
      await submitSupportRequest({ message, contact, contactType, voiceNote });
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#030712]/80 px-4 backdrop-blur-2xl" onClick={onClose}>
      <div className="premium-shell w-full max-w-2xl" onClick={event => event.stopPropagation()}>
        <div className="premium-core relative p-6 md:p-8">
          <button
            type="button"
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-white/10 text-gray-400 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="max-w-xl">
            <div className="eyebrow">поддержка</div>
            <h2 className="mt-4 text-2xl font-semibold text-white">Опишите проблему, голосом или текстом</h2>
            <p className="mt-3 text-sm leading-6 text-gray-400">
              Заявка сохранится в журнале поддержки. Ответ можно отправить в Telegram или на рабочую почту.
            </p>
          </div>

          <div className="mt-7 grid gap-4">
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.16em] text-gray-500">сообщение</span>
              <textarea
                value={message}
                onChange={event => setMessage(event.target.value)}
                className="min-h-32 rounded-2xl border border-white/10 bg-[#07111f] px-4 py-3 text-sm text-cyan-50 outline-none transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] focus:border-cyan-200/40"
                placeholder="Что пошло не так, где это видно, какой API-ключ или модель затронуты..."
              />
            </label>

            <div className="rounded-2xl border border-cyan-200/10 bg-cyan-200/5 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 text-cyan-100">
                  <Mic className="h-4 w-4" />
                  <span className="text-sm font-semibold">Голосовое сообщение</span>
                </div>
                <button
                  type="button"
                  onClick={voiceStatus === 'recording' ? stopRecording : startRecording}
                  disabled={voiceStatus === 'transcribing'}
                  className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-500 disabled:opacity-45 ${
                    voiceStatus === 'recording'
                      ? 'border border-red-300/30 bg-red-300/12 text-red-100'
                      : 'border border-emerald-300/25 bg-emerald-300/12 text-emerald-100 hover:bg-emerald-300/18'
                  }`}
                >
                  {voiceStatus === 'recording' ? <Square className="h-3.5 w-3.5" /> : voiceStatus === 'transcribing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
                  {voiceStatus === 'recording' ? `Остановить ${formatDuration(recordingMs)}` : voiceStatus === 'transcribing' ? 'Расшифровываю...' : 'Записать голос'}
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                Запись идет прямо в браузере, затем backend отправляет audio в Groq Whisper и подставляет расшифровку в сообщение.
              </p>
              <textarea
                value={voiceNote}
                onChange={event => setVoiceNote(event.target.value)}
                className="mt-3 min-h-20 w-full rounded-xl border border-white/10 bg-[#07111f] px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-200/40"
                placeholder="Здесь появится автоматическая расшифровка голосового"
              />
              {voiceStatus === 'done' && <div className="mt-2 text-xs text-emerald-300">Голос расшифрован и добавлен в заявку.</div>}
              {voiceStatus === 'error' && <div className="mt-2 text-xs text-red-300">Запись или расшифровка не сработала. Можно отправить текстом.</div>}
            </div>

            <div className="grid gap-3 md:grid-cols-[11rem_1fr]">
              <div className="grid grid-cols-2 gap-2 rounded-full border border-white/10 bg-white/[0.03] p-1">
                <button
                  type="button"
                  onClick={() => setContactType('telegram')}
                  className={`rounded-full px-3 py-2 text-xs transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${contactType === 'telegram' ? 'bg-cyan-300 text-slate-950' : 'text-gray-400'}`}
                >
                  Telegram
                </button>
                <button
                  type="button"
                  onClick={() => setContactType('email')}
                  className={`rounded-full px-3 py-2 text-xs transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${contactType === 'email' ? 'bg-cyan-300 text-slate-950' : 'text-gray-400'}`}
                >
                  Email
                </button>
              </div>
              <label className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  value={contact}
                  onChange={event => setContact(event.target.value)}
                  className="w-full rounded-full border border-white/10 bg-[#07111f] py-3 pl-10 pr-4 text-sm text-cyan-50 outline-none focus:border-cyan-200/40"
                  placeholder={contactType === 'telegram' ? '@username или t.me/username' : 'name@company.com'}
                />
              </label>
            </div>
          </div>

          <div className="mt-7 flex items-center justify-between gap-4">
            <div className="text-xs text-gray-500">
              {status === 'sent' && <span className="text-emerald-300">Заявка принята.</span>}
              {status === 'error' && <span className="text-red-300">Не удалось отправить. Проверьте контакт и попробуйте снова.</span>}
            </div>
            <button
              type="button"
              disabled={!canSend || status === 'sending' || status === 'sent'}
              onClick={submit}
              className="group inline-flex items-center gap-3 rounded-full bg-cyan-200 py-2 pl-5 pr-2 text-sm font-semibold text-slate-950 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 active:scale-[0.98]"
            >
              {status === 'sent' ? 'Отправлено' : status === 'sending' ? 'Отправляю...' : 'Отправить'}
              <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-950/10 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1">
                {status === 'sent' ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function preferredMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return options.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
