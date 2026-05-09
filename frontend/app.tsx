import { useEffect, useState } from 'react';
import { useAuth } from './lib/auth-context.tsx';
import { Leaderboard } from './components/leaderboard/leaderboard.tsx';
import { Dashboard } from './components/dashboard/dashboard.tsx';
import { SkillsPage } from './components/skills/skills-page.tsx';
import { DeploymentStatus } from './components/deployment/deployment-status.tsx';
import { ModelAvailability } from './components/models/model-availability.tsx';
import { ApiKeyModal } from './components/auth/api-key-modal.tsx';
import { SupportModal } from './components/support/support-modal.tsx';
import { Activity, Copy, KeyRound, LifeBuoy, Lock, LogOut, Sparkles, Zap } from 'lucide-react';
import { displayName } from './lib/display.ts';
import { verifyMagicLink } from './lib/api.ts';

type Page = 'leaderboard' | 'dashboard' | 'skills';

function initialPage(): Page {
  if (typeof window === 'undefined') return 'leaderboard';
  const host = window.location.hostname.toLowerCase();
  const path = window.location.pathname.toLowerCase();
  if (host === 'skills.api.zed.md' || path.startsWith('/skills')) return 'skills';
  return 'leaderboard';
}

export function App() {
  const [page, setPage] = useState<Page>(() => initialPage());
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [magicResult, setMagicResult] = useState<{ rawKey: string; keyPrefix: string } | { error: string } | null>(null);
  const { isAuthenticated, keyName, account, logout, loginAccount } = useAuth();
  const activeName = displayName(keyName ?? account?.displayName ?? null);

  useEffect(() => {
    const titleByPage: Record<Page, string> = {
      leaderboard: 'Рейтинг API — API ZED',
      skills: 'Навыки агентов — API ZED',
      dashboard: activeName ? `Личный кабинет ${activeName} — API ZED` : 'Личный кабинет API — API ZED',
    };
    document.title = titleByPage[page];
  }, [activeName, page]);

  useEffect(() => {
    const token = readMagicLinkToken();
    if (!token) return;
    let cancelled = false;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    verifyMagicLink(token)
      .then(result => {
        if (cancelled) return;
        const key = result.data.defaultKey;
        loginAccount(
          result.data.sessionToken,
          result.data.user,
          null,
          result.data.user.displayName,
          key?.gatewayKeyId ?? null,
        );
        if (key?.rawKey) {
          setMagicResult({ rawKey: key.rawKey, keyPrefix: key.keyPrefix });
        }
        setPage('dashboard');
      })
      .catch(error => {
        if (cancelled) return;
        setMagicResult({ error: error instanceof Error ? error.message : 'Magic link недействителен или истек.' });
        setShowAuthModal(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loginAccount]);

  return (
    <div className="app-shell min-h-screen overflow-x-hidden">
      {/* Header */}
      <header className="app-header border-b border-[#1e293b] bg-[#0a0e1a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1700px] mx-auto px-4 h-auto md:h-[3.25rem] py-2 md:py-0 flex flex-col md:flex-row items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setPage('leaderboard')}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-[#111827]"
            aria-label="На главную страницу"
          >
            <span className="brand-mark grid h-8 w-8 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10">
              <Zap className="w-4 h-4 text-cyan-300" />
            </span>
            <span className="font-semibold text-white text-base tracking-wide">API ZED</span>
          </button>

          <nav className="top-nav flex items-center gap-1.5 flex-wrap">
            <NavBtn active={page === 'leaderboard'} onClick={() => setPage('leaderboard')}>
              <Activity className="w-4 h-4" />
              <span>Рейтинг</span>
            </NavBtn>
            <NavBtn active={page === 'skills'} onClick={() => setPage('skills')}>
              <Sparkles className="w-4 h-4" />
              <span>Навыки</span>
            </NavBtn>
            <button
              onClick={() => setShowSupportModal(true)}
              className="nav-btn ml-1 rounded-full border border-emerald-300/25 bg-emerald-300/10 text-emerald-100 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-emerald-200/50 hover:bg-emerald-300/16 active:scale-[0.98] flex items-center gap-1.5"
              aria-label="Открыть форму поддержки"
            >
              <LifeBuoy className="w-3.5 h-3.5" />
              Нужна помощь
            </button>
            {isAuthenticated ? (
              <>
                <NavBtn active={page === 'dashboard'} onClick={() => setPage('dashboard')}>
                  <Lock className="w-4 h-4" />
                  <span>{activeName}</span>
                </NavBtn>
                <button
                  onClick={logout}
                  className="nav-icon-btn ml-1 text-gray-500 hover:text-red-400 transition-colors"
                  title="Выйти"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="nav-btn ml-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md transition-colors flex items-center gap-1.5 shadow-[0_0_22px_rgba(6,182,212,0.16)]"
                title="Private logs доступны после проверки API key"
              >
                <Lock className="w-3.5 h-3.5" />
                Мои логи
              </button>
            )}
          </nav>
        </div>
      </header>

      {page === 'leaderboard' && <SectionNav />}

      {page === 'leaderboard' && (
        <>
          <DeploymentStatus />
          <ModelAvailability />
        </>
      )}

      {/* Content */}
      <main className="max-w-[1700px] mx-auto px-4 py-5">
        {page === 'leaderboard' && <Leaderboard />}
        {page === 'skills' && <SkillsPage onOpenStats={() => setPage('leaderboard')} />}
        {page === 'dashboard' && isAuthenticated && <Dashboard />}
        {page === 'dashboard' && !isAuthenticated && (
          <div className="text-center py-20 text-gray-500">
            <Lock className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg">Введите API-ключ, чтобы открыть свои логи</p>
            <button
              onClick={() => setShowAuthModal(true)}
              className="mt-4 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md"
            >
              Ввести API-ключ
            </button>
          </div>
        )}
      </main>

      {showAuthModal && (
        <ApiKeyModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => { setShowAuthModal(false); setPage('dashboard'); }}
        />
      )}
      {showSupportModal && <SupportModal onClose={() => setShowSupportModal(false)} />}
      {magicResult && <MagicLinkResultModal result={magicResult} onClose={() => setMagicResult(null)} />}
    </div>
  );
}

function readMagicLinkToken(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get('token') ?? params.get('magic');
}

function MagicLinkResultModal({
  result,
  onClose,
}: {
  result: { rawKey: string; keyPrefix: string } | { error: string };
  onClose: () => void;
}) {
  const isError = 'error' in result;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={onClose}>
      <div className="surface-card w-full max-w-md rounded-xl border p-6 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className={`h-5 w-5 ${isError ? 'text-red-300' : 'text-emerald-300'}`} />
          <h2 className="text-lg font-semibold text-white">{isError ? 'Ссылка не сработала' : 'Email подтвержден'}</h2>
        </div>
        {isError ? (
          <p className="text-sm text-red-200">{result.error}</p>
        ) : (
          <>
            <p className="text-sm text-gray-400">Аккаунт активирован. Сохраните первый API key сейчас: полный ключ больше не будет показан.</p>
            <div className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-300/8 p-3 font-mono text-xs text-emerald-100 break-all">{result.rawKey}</div>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(result.rawKey)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 py-2.5 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-300/16"
            >
              <Copy className="h-4 w-4" />
              Скопировать ключ
            </button>
          </>
        )}
        <button onClick={onClose} className="mt-4 w-full rounded-lg bg-cyan-600 py-2.5 font-medium text-white transition-colors hover:bg-cyan-500">
          Открыть кабинет
        </button>
      </div>
    </div>
  );
}

function SectionNav() {
  const items = [
    { href: '#status', label: 'Status' },
    { href: '#models', label: 'Models' },
    { href: '#ranking', label: 'Ranking' },
    { href: '#analytics', label: 'Analytics' },
  ];

  return (
    <div className="section-nav border-b border-[#1e293b] bg-[#0a0e1a]/88 backdrop-blur-md">
      <div className="max-w-[1700px] mx-auto flex gap-2 overflow-x-auto px-4 py-2">
        {items.map(item => (
          <a
            key={item.href}
            href={item.href}
            className="section-pill shrink-0 rounded-full border border-white/10 bg-white/[0.025] text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 transition-colors hover:border-cyan-200/35 hover:text-cyan-100"
          >
            {item.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function NavBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`nav-btn rounded-md flex items-center gap-1.5 transition-colors ${
        active
          ? 'bg-[#1e293b] text-cyan-400'
          : 'text-gray-400 hover:text-gray-200 hover:bg-[#111827]'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </button>
  );
}
