import { useState } from 'react';
import { useAuth } from '../../lib/auth-context.tsx';
import { validateApiKey } from '../../lib/api.ts';
import { X, Key, Loader2 } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export function ApiKeyModal({ onClose, onSuccess }: Props) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;

    setLoading(true);
    setError('');

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="surface-card border rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-white">Вход по API-ключу</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-400 mb-4">
          Введите ключ API ZED, чтобы открыть свои запросы, сессии, подробные логи и статистику.
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={key}
            onChange={event => setKey(event.currentTarget.value)}
            placeholder="agisota-xxxx-pzdrk-xxxx"
            className="w-full px-3 py-2.5 bg-[#0a0e1a] border border-[#1e293b] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono text-sm"
            autoFocus
          />

          {error && (
            <p className="mt-2 text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !key.trim()}
            className="mt-4 w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Проверяем...</>
            ) : (
              'Открыть мои логи'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
