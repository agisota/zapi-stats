import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { AccountUser } from './api.ts';

interface AuthState {
  apiKey: string | null;
  keyName: string | null;
  keyId: string | null;
  accountSession: string | null;
  account: AccountUser | null;
}

interface AuthContextType extends AuthState {
  login: (apiKey: string, keyName: string, keyId: string) => void;
  loginAccount: (sessionToken: string, account: AccountUser, apiKey?: string | null, keyName?: string | null, keyId?: string | null) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);
const AUTH_STORAGE_KEY = 'api-zed-auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const saved = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (saved) {
      try { return JSON.parse(saved) as AuthState; } catch { /* ignore */ }
    }
    return { apiKey: null, keyName: null, keyId: null, accountSession: null, account: null };
  });

  const login = useCallback((apiKey: string, keyName: string, keyId: string) => {
    const s = { apiKey, keyName, keyId, accountSession: null, account: null };
    setState(s);
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(s));
  }, []);

  const loginAccount = useCallback((sessionToken: string, account: AccountUser, apiKey?: string | null, keyName?: string | null, keyId?: string | null) => {
    const s = {
      apiKey: apiKey ?? null,
      keyName: keyName ?? account.displayName,
      keyId: keyId ?? null,
      accountSession: sessionToken,
      account,
    };
    setState(s);
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(s));
  }, []);

  const logout = useCallback(() => {
    setState({ apiKey: null, keyName: null, keyId: null, accountSession: null, account: null });
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  return (
    <AuthContext value={{
      ...state,
      login,
      loginAccount,
      logout,
      isAuthenticated: state.apiKey !== null || state.accountSession !== null,
    }}>
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
