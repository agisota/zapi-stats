import { useQuery } from '@tanstack/react-query';
import { Search, Lightbulb, Star, X } from 'lucide-react';
import { getUserProfile } from '../../lib/api.ts';

interface UserProfileModalProps {
  name: string;
  onClose: () => void;
}

export function UserProfileModal({ name, onClose }: UserProfileModalProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['userProfile', name],
    queryFn: () => getUserProfile(name),
  });

  const profile = data?.data;

  const initial = profile?.displayName.startsWith('@')
    ? profile.displayName[1]?.toUpperCase()
    : profile?.displayName[0]?.toUpperCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-[#111827] border border-[#1e293b] rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[#1e293b] flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
            {initial ?? '?'}
          </div>
          <div>
            <p className="text-white font-semibold text-base">
              {profile?.displayName ?? name}
            </p>
            <p className="text-gray-500 text-xs">User profile</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6">
          {isLoading && (
            <p className="text-gray-500 text-sm text-center py-6">Loading…</p>
          )}

          {isError && (
            <p className="text-red-400 text-sm text-center py-6">Failed to load profile.</p>
          )}

          {profile && (
            <>
              {/* Patterns */}
              <Section
                icon={<Search className="w-4 h-4 text-cyan-400" />}
                title="Patterns"
                items={profile.patterns}
                cardClass="bg-cyan-950/40 border border-cyan-900/50 text-cyan-200"
              />

              {/* Recommendations */}
              <Section
                icon={<Lightbulb className="w-4 h-4 text-amber-400" />}
                title="Recommendations"
                items={profile.recommendations}
                cardClass="bg-amber-950/40 border border-amber-900/50 text-amber-200"
              />

              {/* Highlights */}
              <Section
                icon={<Star className="w-4 h-4 text-emerald-400" />}
                title="Highlights"
                items={profile.highlights}
                cardClass="bg-emerald-950/40 border border-emerald-900/50 text-emerald-200"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  items: string[];
  cardClass: string;
}

function Section({ icon, title, items, cardClass }: SectionProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">{title}</h3>
      </div>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className={`rounded-lg px-3 py-2 text-sm ${cardClass}`}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
