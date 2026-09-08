import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Staff = { id: string; email: string; role: "ADMIN" | "OPERATOR" };

type AuthState = {
  token: string | null;
  staff: Staff | null;
  login: (token: string, staff: Staff) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = "ewallet_token";
const STAFF_KEY = "ewallet_staff";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [staff, setStaff] = useState<Staff | null>(() => {
    const raw = localStorage.getItem(STAFF_KEY);
    return raw ? (JSON.parse(raw) as Staff) : null;
  });

  const value = useMemo<AuthState>(
    () => ({
      token,
      staff,
      login: (t, s) => {
        localStorage.setItem(TOKEN_KEY, t);
        localStorage.setItem(STAFF_KEY, JSON.stringify(s));
        setToken(t);
        setStaff(s);
      },
      logout: () => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(STAFF_KEY);
        setToken(null);
        setStaff(null);
      },
    }),
    [token, staff]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
