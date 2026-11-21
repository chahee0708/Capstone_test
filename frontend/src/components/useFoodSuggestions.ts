/**
 * useFoodSuggestions.ts
 *
 * 역할: 식품명 자동완성 후보를 가져오는 hook
 *       글자를 칠 때마다 요청하지 않도록 0.3초 기다렸다가 GET /recommend/search?q= 호출
 *       같은 이름이 여러 번 오면 하나만 남긴다 (DB 에 같은 이름의 음식이 여러 개 있음)
 *
 * 쓰이는 곳: frontend/src/app/pages/HomePage.tsx
 *
 * 사용 예)
 *   const { suggestions, update, clear } = useFoodSuggestions();
 *   <input onChange={(e) => { setQuery(e.target.value); update(e.target.value); }} />
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export function useFoodSuggestions() {
  const { token } = useAuth();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 늦게 도착한 예전 요청 결과가 새 결과를 덮지 않게 요청 번호를 센다
  const requestIdRef = useRef(0);

  /** 목록 닫기 + 대기 중인 요청 취소 */
  const clear = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    requestIdRef.current += 1;
    setSuggestions([]);
  };

  /** 입력값이 바뀔 때 호출: 0.3초 뒤 후보 요청 */
  const update = (value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = value.trim();
    if (!q) {
      clear();
      return;
    }
    timerRef.current = setTimeout(async () => {
      const id = ++requestIdRef.current;
      try {
        const res = await fetch(`${API_URL}/recommend/search?q=${encodeURIComponent(q)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const names: string[] = res.ok ? await res.json() : [];
        if (id === requestIdRef.current) setSuggestions([...new Set(names)]);
      } catch {
        if (id === requestIdRef.current) setSuggestions([]);
      }
    }, 300);
  };

  // 화면을 떠날 때 대기 중인 타이머 정리
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { suggestions, update, clear };
}
