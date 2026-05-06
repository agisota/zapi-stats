import { useEffect, useState } from 'react';
import { useAuth } from './lib/auth-context.tsx';
import { Leaderboard } from './components/leaderboard/leaderboard.tsx';
import { Dashboard } from './components/dashboard/dashboard.tsx';
import { SkillsPage } from './components/skills/skills-page.tsx';
import { DeploymentStatus } from './components/deployment/deployment-status.tsx';
import { ModelAvailability } from './components/models/model-availability.tsx';
import { ApiKeyModal } from './components/auth/api-key-modal.tsx';
import { SupportModal } from './components/support/support-modal.tsx';
import { Activity, LifeBuoy, Lock, LogOut, Sparkles, Zap } from 'lucide-react';
import { displayName } from './lib/display.ts';

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
  const { isAuthenticated, keyName, logout } = useAuth();
  const activeName = displayName(keyName);

  useEffect(() => {
    const titleByPage: Record<Page, string> = {
      leaderboard: 'Рейтинг API — API ZED',
      skills: 'Навыки агентов — API ZED',
      dashboard: activeName ? `Личный кабинет ${activeName} — API ZED` : 'Личный кабинет API — API ZED',
    };
    document.title = titleByPage[page];
  }, [activeName, page]);

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
