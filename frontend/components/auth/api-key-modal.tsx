import { useState } from 'react';
import { useAuth } from '../../lib/auth-context.tsx';
import { loginAccount as loginAccountRequest, registerAccount, validateApiKey } from '../../lib/api.ts';
import { X, Key, Loader2, UserPlus } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export function ApiKeyModal({ onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<'key' | 'register' | 'account-login'>('key');
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, loginAccount } = useAuth();

  const switchMode = (nextMode: 'key' | 'register' | 'account-login') => {
    setMode(nextMode);
    setError('');
    setNotice('');
    setIssuedKey(null);
  };

  const handleKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;

    setLoading(true);
    setError('');
    setNotice('');

    try {
      const result = await validateApiKey(key.trim());
      if (result.valid) {
        login(key.trim(), result.keyName, result.keyId);
        onSuccess();
      } else {
        setError('API-ключ не найден или отключен');
      }
    } catch {
      setError('Не удалось проверить ключ');
    } finally {
      setLoading(false);
    }
  };

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError('');
    setNotice('');
    setIssuedKey(null);

    try {
      if (mode === 'register') {
        const result = await registerAccount({ email: email.trim(), displayName: displayName.trim() || undefined });
        const rawKey = result.data.defaultKey?.rawKey ?? null;
        if (result.data.sessionToken) {
          loginAccount(
            result.data.sessionToken,
            result.data.user,
            null,
            result.data.user.displayName,
            result.data.defaultKey?.gatewayKeyId ?? null,
          );
        }
        setIssuedKey(rawKey);
        if (!rawKey && result.data.sessionToken) onSuccess();
        if (!rawKey && !result.data.sessionToken) {
          if (result.data.magicLinkSent) {
            setNotice('Аккаунт создан. Мы отправили одноразовую ссылку на email; после проверки откроется кабинет.');
          } else {
            setError('Аккаунт создан, но production email-провайдер еще не настроен. Вход и ключ будут доступны после верификации.');
          }
        }
      } else {
        const result = await loginAccountRequest(email.trim());
        if (result.data.sessionToken && result.data.user) {
          loginAccount(result.data.sessionToken, result.data.user);
          onSuccess();
        } else if (result.data.magicLinkSent) {
          setNotice('Если аккаунт существует, мы отправили одноразовую ссылку для входа на указанный email.');
        } else {
          setError('Не удалось открыть аккаунт');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть аккаунт');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="surface-card border rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {mode === 'register' ? <UserPlus className="w-5 h-5 text-cyan-400" /> : <Key className="w-5 h-5 text-cyan-400" />}
            <h2 className="text-lg font-semibold text-white">{mode === 'register' ? 'Регистрация API ZED' : mode === 'account-login' ? 'Вход в аккаунт' : 'Вход по API-ключу'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-[#1e293b] bg-[#0a0e1a] p-1 text-xs">
          <button className={`rounded-md px-2 py-2 ${mode === 'key' ? 'bg-cyan-500/20 text-cyan-100' : 'text-gray-500'}`} onClick={() => switchMode('key')}>API key</button>
          <button className={`rounded-md px-2 py-2 ${mode === 'register' ? 'bg-cyan-500/20 text-cyan-100' : 'text-gray-500'}`} onClick={() => switchMode('register')}>Регистрация</button>
          <button className={`rounded-md px-2 py-2 ${mode === 'account-login' ? 'bg-cyan-500/20 text-cyan-100' : 'text-gray-500'}`} onClick={() => switchMode('account-login')}>Аккаунт</button>
        </div>

        {mode === 'key' ? (
          <form onSubmit={handleKeySubmit}>
            <p className="text-sm text-gray-400 mb-4">
              Введите ключ API ZED, чтобы открыть свои запросы, сессии, подробные логи и статистику.
            </p>
            <input
              type="password"
              value={key}
              onChange={event => setKey(event.currentTarget.value)}
              placeholder="agisota-xxxx-pzdrk-xxxx"
              className="w-full px-3 py-2.5 bg-[#0a0e1a] border border-[#1e293b] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono text-sm"
              autoFocus
            />

            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            {notice && <p className="mt-2 rounded-lg border border-emerald-300/20 bg-emerald-300/8 px-3 py-2 text-sm text-emerald-100">{notice}</p>}

            <SubmitButton loading={loading} disabled={!key.trim()} text="Открыть мои логи" loadingText="Проверяем..." />
          </form>
        ) : issuedKey ? (
          <div>
            <p className="text-sm text-gray-400">Аккаунт создан. Сохраните API key сейчас: полный ключ больше не будет показан.</p>
            <div className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-300/8 p-3 font-mono text-xs text-emerald-100 break-all">{issuedKey}</div>
            <button onClick={onSuccess} className="mt-4 w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium">Открыть кабинет</button>
          </div>
        ) : (
          <form onSubmit={handleAccountSubmit}>
            <p className="text-sm text-gray-400 mb-4">
              {mode === 'register'
                ? 'Создайте аккаунт. В production мы сначала проверяем email одноразовой ссылкой, затем выдаем первый API key.'
                : 'Введите email: в production придет одноразовая ссылка для входа, API key вводить не нужно.'}
            </p>
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.currentTarget.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2.5 bg-[#0a0e1a] border border-[#1e293b] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm"
              autoFocus
            />
            {mode === 'register' && (
              <input
                type="text"
                value={displayName}
                onChange={event => setDisplayName(event.currentTarget.value)}
                placeholder="Имя в кабинете"
                className="mt-3 w-full px-3 py-2.5 bg-[#0a0e1a] border border-[#1e293b] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm"
              />
            )}
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            {notice && <p className="mt-2 rounded-lg border border-emerald-300/20 bg-emerald-300/8 px-3 py-2 text-sm text-emerald-100">{notice}</p>}
            <SubmitButton loading={loading} disabled={!email.trim()} text={mode === 'register' ? 'Создать аккаунт' : 'Отправить ссылку'} loadingText="Обрабатываем..." />
          </form>
        )}
      </div>
    </div>
  );
}

function SubmitButton({ loading, disabled, text, loadingText }: { loading: boolean; disabled: boolean; text: string; loadingText: string }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="mt-4 w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
    >
      {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> {loadingText}</> : text}
    </button>
  );
}
