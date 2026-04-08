import { useState } from 'react';
import { useAuth } from './lib/auth-context.tsx';
import { Leaderboard } from './components/leaderboard/leaderboard.tsx';
import { StatsPage } from './components/stats/stats-page.tsx';
import { Dashboard } from './components/dashboard/dashboard.tsx';
import { ApiKeyModal } from './components/auth/api-key-modal.tsx';
import { Activity, BarChart3, Lock, LogOut, Zap } from 'lucide-react';

type Page = 'leaderboard' | 'stats' | 'dashboard';

export function App() {
  const [page, setPage] = useState<Page>('leaderboard');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { isAuthenticated, keyName, logout } = useAuth();

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      {/* Header */}
      <header className="border-b border-[#1e293b] bg-[#0a0e1a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-auto md:h-14 py-2 md:py-0 flex flex-col md:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-cyan-400" />
            <span className="font-semibold text-white text-lg">API ZED</span>
          </div>

          <nav className="flex items-center gap-1 flex-wrap">
            <NavBtn active={page === 'leaderboard'} onClick={() => setPage('leaderboard')}>
              <Activity className="w-4 h-4" />
              <span>Leaderboard</span>
            </NavBtn>
            <NavBtn active={page === 'stats'} onClick={() => setPage('stats')}>
              <BarChart3 className="w-4 h-4" />
              <span>Analytics</span>
            </NavBtn>
            {isAuthenticated ? (
              <>
                <NavBtn active={page === 'dashboard'} onClick={() => setPage('dashboard')}>
                  <Lock className="w-4 h-4" />
                  <span>{keyName}</span>
                </NavBtn>
                <button
                  onClick={logout}
                  className="ml-2 p-2 text-gray-500 hover:text-red-400 transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="ml-2 px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded-md transition-colors flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5" />
                My Logs
              </button>
            )}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {page === 'leaderboard' && <Leaderboard />}
        {page === 'stats' && <StatsPage />}
        {page === 'dashboard' && isAuthenticated && <Dashboard />}
        {page === 'dashboard' && !isAuthenticated && (
          <div className="text-center py-20 text-gray-500">
            <Lock className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg">Enter your API key to view your logs</p>
            <button
              onClick={() => setShowAuthModal(true)}
              className="mt-4 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md"
            >
              Enter API Key
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
    </div>
  );
}

function NavBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 transition-colors ${
        active
          ? 'bg-[#1e293b] text-cyan-400'
          : 'text-gray-400 hover:text-gray-200 hover:bg-[#111827]'
      }`}
    >
      {children}
    </button>
  );
}
