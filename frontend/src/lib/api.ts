/**
 * api.ts
 *
 * 백엔드 호출 공용 래퍼.
 * - 쿠키 기반 인증이므로 항상 credentials: "include"
 * - accessToken(1시간) 만료로 401 이 오면 refresh 를 한 번 시도한 뒤 원 요청을 재시도
 * - refresh 도 실패하면 세션 만료 이벤트를 발생시켜 AuthContext 가 로그아웃 처리하게 함
 */

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export const SESSION_EXPIRED_EVENT = "safebite:session-expired";

// 401 이어도 refresh 재시도를 하지 않는 인증 엔드포인트
const NO_REFRESH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"];

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  // 동시에 여러 요청이 401 을 받아도 refresh 는 한 번만 보낸다.
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  // FormData(이미지 업로드)는 브라우저가 multipart 경계를 포함한 Content-Type 을 직접 채운다
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body !== undefined && !isForm && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const send = () =>
    fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });

  let res = await send();

  if (res.status === 401 && !NO_REFRESH_PATHS.includes(path)) {
    if (await refreshSession()) {
      res = await send();
    }
    if (res.status === 401) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
  }
  return res;
}

/**
 * 응답 본문에서 서버 메시지를 꺼낸다. 본문이 JSON 이 아니거나 비어 있어도 fallback 을 반환한다.
 */
export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.message === "string" && data.message) return data.message;
  } catch {
    /* JSON 이 아닌 응답 */
  }
  return fallback;
}
