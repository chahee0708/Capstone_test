import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { apiFetch, readErrorMessage, SESSION_EXPIRED_EVENT } from "../lib/api";

type User = {
  id: number;
  name: string;
  email: string;
};

/**
 * 가입 시 함께 저장할 건강 프로필 (서버 users 컬럼과 동일한 이름/타입)
 */
export type RegisterProfile = {
  age?: number | null;
  weight?: number | null;
  height?: number | null;
  gender?: "male" | "female" | null;
  diseases?: string[];
  allergens?: string[];
  hypertension_stage?: 1 | 2;
  ldl_value?: number | null;
  tg_value?: number | null;
  hdl_value?: number | null;
  gfr_value?: number | null;
};

type AuthContextType = {
  user: User | null;
  token: string | null; // Compatibility purpose
  login: (email: string, password: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string,
    profile?: RegisterProfile,
  ) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // accessToken 이 만료됐어도 refreshToken 이 유효하면 apiFetch 가 자동으로 갱신한다.
        const res = await apiFetch("/auth/me");
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch (err) {
        console.error("Failed to restore session:", err);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  // 세션이 만료되면 로그인 화면으로 이동하도록 사용자 상태를 비운다.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "로그인 실패"));
    }
    const data = await res.json();
    setUser(data.user);
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string, profile?: RegisterProfile) => {
      const res = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, profile }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "회원가입 실패"));
      }
      const data = await res.json();
      setUser(data.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout error", error);
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token: null, login, register, logout, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
