import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, Copy, KeyRound, Loader2, RefreshCw, ShieldAlert, WalletCards } from 'lucide-react';
import {
  createAccountKey,
  createTopup,
  getAccountBalance,
  getAccountExpenses,
  getAccountKeys,
  getAccountLedger,
  getAccountSkillAnalytics,
  revokeAccountKey,
  rotateAccountKey,
  updateAccountKeyLimits,
  type AccountUser,
  type ExpenseAnalytics,
  type KeyLimits,
  type ManagedApiKey,
  type SkillAnalytics,
} from '../../lib/api.ts';
import { formatCost, formatNumber } from '../../lib/format.ts';

export function AccountConsole({ sessionToken, account }: { sessionToken: string; account: AccountUser }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('25');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const balance = useQuery({
    queryKey: ['account-balance', sessionToken],
    queryFn: () => getAccountBalance(sessionToken),
  });
  const ledger = useQuery({
    queryKey: ['account-ledger', sessionToken],
    queryFn: () => getAccountLedger(sessionToken),
  });
  const keys = useQuery({
    queryKey: ['account-keys', sessionToken],
    queryFn: () => getAccountKeys(sessionToken),
  });
  const skillAnalytics = useQuery({
    queryKey: ['account-skill-analytics', sessionToken],
    queryFn: () => getAccountSkillAnalytics(sessionToken, '30d'),
  });
  const expenses = useQuery({
    queryKey: ['account-expenses', sessionToken],
    queryFn: () => getAccountExpenses(sessionToken, '30d'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['account-keys', sessionToken] });
    qc.invalidateQueries({ queryKey: ['account-balance', sessionToken] });
    qc.invalidateQueries({ queryKey: ['account-ledger', sessionToken] });
  };

  const createKey = useMutation({
    mutationFn: () => createAccountKey(sessionToken, { displayName: `API key ${new Date().toISOString().slice(0, 10)}` }),
    onSuccess: result => {
      setRevealedKey(result.data.rawKey);
      invalidate();
    },
  });

  const topup = useMutation({
    mutationFn: () => createTopup(sessionToken, Number(amount)),
    onSuccess: result => {
      setCheckoutUrl(result.data.checkout.checkoutUrl);
      invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: (keyId: string) => revokeAccountKey(sessionToken, keyId),
    onSuccess: invalidate,
  });

  const rotate = useMutation({
    mutationFn: (keyId: string) => rotateAccountKey(sessionToken, keyId),
    onSuccess: result => {
      setRevealedKey(result.data.rawKey);
      invalidate();
    },
  });

  const updateLimits = useMutation({
    mutationFn: ({ keyId, limits }: { keyId: string; limits: Partial<KeyLimits> }) => updateAccountKeyLimits(sessionToken, keyId, limits),
    onSuccess: invalidate,
  });

  const activeKeys = keys.data?.data.filter(key => key.status === 'active') ?? [];
  const wallet = balance.data?.data;

  return (
    <section className="surface-card rounded-2xl border p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">Личный кабинет</div>
          <h3 className="mt-2 text-xl font-semibold text-white">{account.displayName}</h3>
          <div className="mt-1 text-sm text-gray-500">{account.email}</div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Metric label="баланс" value={wallet ? formatCost(wallet.available) : '...'} />
          <Metric label="резерв" value={wallet ? formatCost(wallet.reserved) : '...'} />
          <Metric label="ключи" value={String(activeKeys.length)} />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 rounded-xl border border-white/10 bg-[#07111f]/70 p-4">
          <div className="flex items-center gap-2 text-cyan-100">
            <WalletCards className="h-4 w-4" />
            <div className="font-semibold">Пополнение DV.net</div>
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={amount}
              onChange={event => setAmount(event.currentTarget.value)}
              className="min-w-0 flex-1 rounded-lg border border-[#263044] bg-[#0a0e1a] px-3 py-2 text-sm text-white outline-none"
              inputMode="decimal"
            />
            <button onClick={() => topup.mutate()} disabled={topup.isPending} className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {topup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Пополнить'}
            </button>
          </div>
          {checkoutUrl ? (
            <a href={checkoutUrl} className="mt-3 block truncate rounded-lg border border-emerald-300/20 bg-emerald-300/8 px-3 py-2 text-xs text-emerald-100" target="_blank" rel="noreferrer">
              Открыть payment link
            </a>
          ) : (
            <div className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/8 px-3 py-2 text-xs leading-5 text-amber-100">
              Платёжная ссылка появится после подключения live-адаптера DV.net.
            </div>
          )}
        </div>

        <div className="lg:col-span-8 rounded-xl border border-white/10 bg-[#07111f]/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-cyan-100">
              <KeyRound className="h-4 w-4" />
              <div className="font-semibold">API keys и лимиты OmniRoute</div>
            </div>
            <button onClick={() => createKey.mutate()} disabled={createKey.isPending} className="rounded-lg border border-cyan-300/20 px-3 py-1.5 text-xs text-cyan-100 disabled:opacity-50">
              Создать ключ
            </button>
          </div>

          {revealedKey && (
            <div className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-300/8 p-3">
              <div className="text-xs text-emerald-100">Новый API key. Показывается один раз.</div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-black/25 px-2 py-1 text-xs text-emerald-50">{revealedKey}</code>
                <button onClick={() => navigator.clipboard?.writeText(revealedKey)} className="rounded border border-emerald-300/20 p-2 text-emerald-100" title="Copy">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <div className="mt-3 space-y-2">
            {(keys.data?.data ?? []).map(key => (
              <KeyCard
                key={key.id}
                apiKey={key}
                saving={updateLimits.isPending}
                rotating={rotate.isPending}
                revoking={revoke.isPending}
                onSaveLimits={limits => updateLimits.mutate({ keyId: key.id, limits })}
                onRotate={() => rotate.mutate(key.id)}
                onRevoke={() => revoke.mutate(key.id)}
              />
            ))}
            {keys.data?.data.length === 0 && (
              <div className="rounded-lg border border-white/10 p-4 text-sm text-gray-500">Ключи еще не созданы.</div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/10 bg-[#07111f]/70 p-4">
          <div className="flex items-center gap-2 text-cyan-100">
            <ShieldAlert className="h-4 w-4" />
            <div className="font-semibold">Синхронизация лимитов</div>
          </div>
          <p className="mt-2 text-xs leading-5 text-gray-500">
            synced: ключ и лимиты записаны в OmniRoute. shadow: ключ работает через stats-auth до включения OMNIROUTE_RW_DB_PATH. suspended: баланс не покрывает новые запросы.
          </p>
          {wallet?.usageSync && (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs text-gray-400">
              Usage sync: {wallet.usageSync.scanned} rows scanned, {formatCost(wallet.usageSync.totalDebited)} debited.
            </div>
          )}
        </div>
        <div className="rounded-xl border border-white/10 bg-[#07111f]/70 p-4">
          <div className="font-semibold text-white">Последние операции</div>
          <div className="mt-3 space-y-2">
            {(ledger.data?.data ?? []).slice(0, 4).map(entry => (
              <div key={entry.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate text-gray-300">{entry.label}</div>
                  <div className="text-[11px] text-gray-600">{new Date(entry.createdAt).toLocaleString()}</div>
                </div>
                <div className={entry.amount >= 0 ? 'font-mono text-emerald-200' : 'font-mono text-rose-200'}>{entry.amount >= 0 ? '+' : ''}{formatCost(entry.amount)}</div>
              </div>
            ))}
            {ledger.data?.data.length === 0 && <div className="text-sm text-gray-500">Пока нет операций.</div>}
          </div>
        </div>
      </div>

      <AccountAnalyticsPanels skills={skillAnalytics.data?.data} expenses={expenses.data?.data} />
    </section>
  );
}

function AccountAnalyticsPanels({ skills, expenses }: { skills?: SkillAnalytics; expenses?: ExpenseAnalytics }) {
  const skillDays = (skills?.daily ?? []).slice(-14);
  const expenseDays = (expenses?.daily ?? []).slice(-14);
  const maxSkills = Math.max(1, ...skillDays.map(day => day.total));
  const maxCost = Math.max(1, ...expenseDays.map(day => day.totalCost));

  return (
    <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="rounded-xl border border-white/10 bg-[#07111f]/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-cyan-100">
            <BrainCircuit className="h-4 w-4" />
            <div className="font-semibold">Мои активации skills</div>
          </div>
          <div className="font-mono text-sm text-cyan-100">{formatNumber(skills?.totalInvocations ?? 0)}</div>
        </div>
        <div className="mt-3 flex h-28 items-end gap-1.5 rounded-lg border border-white/10 bg-black/10 px-3 py-2">
          {skillDays.length === 0 ? (
            <div className="grid h-full w-full place-items-center text-xs text-gray-600">нет активаций за 30 дней</div>
          ) : skillDays.map(day => (
            <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-cyan-300/70"
                style={{ height: `${Math.max(8, (day.total / maxSkills) * 88)}px` }}
                title={`${day.date}: ${formatNumber(day.total)} skill invocations`}
              />
              <span className="max-w-full truncate text-[9px] text-gray-600">{day.date.slice(5)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-2">
          {(skills?.topSkills ?? []).slice(0, 4).map(item => (
            <div key={item.skillId} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0 truncate text-gray-300">{item.skillSlug}</div>
              <div className="font-mono text-cyan-100">{formatNumber(item.count)}</div>
            </div>
          ))}
          {(skills?.recent ?? []).slice(0, 3).map(item => (
            <div key={item.id} className="rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-white">{item.skillSlug}</span>
                <span className="font-mono text-gray-500">{new Date(item.createdAt).toLocaleDateString('ru-RU')}</span>
              </div>
              <div className="mt-1 text-gray-500">{item.action} через {item.source}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#07111f]/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-cyan-100">
            <WalletCards className="h-4 w-4" />
            <div className="font-semibold">Мой расход по дням</div>
          </div>
          <div className="font-mono text-sm text-amber-100">{formatCost(expenses?.totalCost ?? 0)}</div>
        </div>
        <div className="mt-3 flex h-28 items-end gap-1.5 rounded-lg border border-white/10 bg-black/10 px-3 py-2">
          {expenseDays.length === 0 ? (
            <div className="grid h-full w-full place-items-center text-xs text-gray-600">нет списаний за 30 дней</div>
          ) : expenseDays.map(day => (
            <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-amber-300/75"
                style={{ height: `${Math.max(8, (day.totalCost / maxCost) * 88)}px` }}
                title={`${day.date}: ${formatCost(day.totalCost)}, ${formatNumber(day.totalRequests)} запросов`}
              />
              <span className="max-w-full truncate text-[9px] text-gray-600">{day.date.slice(5)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label="cost" value={formatCost(expenses?.totalCost ?? 0)} />
          <Metric label="запросы" value={formatNumber(expenses?.totalRequests ?? 0)} />
          <Metric label="дней" value={formatNumber(expenses?.daily.length ?? 0)} />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#07111f]/70 p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-600">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-semibold text-cyan-100">{value}</div>
    </div>
  );
}

function KeyCard({
  apiKey,
  saving,
  rotating,
  revoking,
  onSaveLimits,
  onRotate,
  onRevoke,
}: {
  apiKey: ManagedApiKey;
  saving: boolean;
  rotating: boolean;
  revoking: boolean;
  onSaveLimits: (limits: Partial<KeyLimits>) => void;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  const [rpm, setRpm] = useState(String(apiKey.limits.maxRequestsPerMinute));
  const [rpd, setRpd] = useState(String(apiKey.limits.maxRequestsPerDay));
  useEffect(() => {
    setRpm(String(apiKey.limits.maxRequestsPerMinute));
    setRpd(String(apiKey.limits.maxRequestsPerDay));
  }, [apiKey.limits.maxRequestsPerDay, apiKey.limits.maxRequestsPerMinute]);
  const rpmNumber = Number(rpm);
  const rpdNumber = Number(rpd);
  const dirty = rpmNumber !== apiKey.limits.maxRequestsPerMinute || rpdNumber !== apiKey.limits.maxRequestsPerDay;
  const valid = Number.isFinite(rpmNumber) && rpmNumber > 0 && Number.isFinite(rpdNumber) && rpdNumber > 0;

  return (
    <div className="rounded-lg border border-white/10 bg-black/15 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-white">{apiKey.displayName}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${apiKey.syncStatus === 'synced' ? 'bg-emerald-300/10 text-emerald-100' : apiKey.syncStatus === 'failed' ? 'bg-rose-300/10 text-rose-100' : 'bg-amber-300/10 text-amber-100'}`}>
              {apiKey.syncStatus}
            </span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-gray-400">{apiKey.status}</span>
          </div>
          <div className="mt-1 font-mono text-xs text-gray-500">{apiKey.keyPrefix}...</div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-400">
            <span>{apiKey.noLog ? 'no_log' : 'logs on'}</span>
            <span>{apiKey.limits.allowedModels.length || 'all'} models</span>
            <span>{apiKey.limits.allowedConnections.length || 'all'} connections</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onRotate} disabled={apiKey.status !== 'active' || rotating} className="rounded-lg border border-cyan-300/20 px-3 py-1.5 text-xs text-cyan-100 disabled:opacity-40">
            <RefreshCw className="inline h-3.5 w-3.5" /> заменить
          </button>
          <button onClick={onRevoke} disabled={apiKey.status !== 'active' || revoking} className="rounded-lg border border-rose-300/20 px-3 py-1.5 text-xs text-rose-100 disabled:opacity-40">
            отозвать
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="text-[11px] uppercase tracking-wide text-gray-500">
          RPM
          <input
            value={rpm}
            onChange={event => setRpm(event.currentTarget.value)}
            inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-[#263044] bg-[#0a0e1a] px-3 py-2 font-mono text-xs text-white outline-none"
          />
        </label>
        <label className="text-[11px] uppercase tracking-wide text-gray-500">
          RPD
          <input
            value={rpd}
            onChange={event => setRpd(event.currentTarget.value)}
            inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-[#263044] bg-[#0a0e1a] px-3 py-2 font-mono text-xs text-white outline-none"
          />
        </label>
        <button
          onClick={() => onSaveLimits({ maxRequestsPerMinute: rpmNumber, maxRequestsPerDay: rpdNumber })}
          disabled={!dirty || !valid || saving || apiKey.status === 'revoked'}
          className="self-end rounded-lg border border-cyan-300/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40"
        >
          сохранить лимиты
        </button>
      </div>
    </div>
  );
}
