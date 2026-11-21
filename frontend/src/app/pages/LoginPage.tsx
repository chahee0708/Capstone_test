/**
 * LoginPage.tsx
 *
 * 역할: 로그인 화면 (/login)
 *
 * 디자인: 네이버 로그인 화면과 비슷한 배치 (로고·색은 SafeBite 것)
 *   - 흰 바탕, 위쪽 가운데 SafeBite 글자 (테마색)
 *   - 테두리 있는 판 하나 안에
 *       이메일 / 비밀번호 칸은 상자 없이 밑줄만 + 떠오르는 이름표 (FloatingField: 누르면 이름표가 작아지며 위로, 밑줄은 테마색, 오류 칸은 빨강)
 *       입력 오류는 상자 바로 아래 빨간 글씨 한 줄 (첫 번째 오류만)
 *       큰 테마색 로그인 버튼 (가로 꽉 차게)
 *   - 판 아래 작은 회색 링크: 회원가입
 *   - 화면 맨 아래 작은 회색 "© 2026 SafeBite"
 *   - 네이버 화면에 있는 로그인 상태 유지, IP 보안, 패스키·QR코드·일회용 번호 로그인, 광고, 상담, 고객센터는 넣지 않는다
 *     (아이디 찾기·비밀번호 찾기도 이 앱에 기능이 없어서 넣지 않는다)
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, Link } from "react-router";

import { useAuth } from "../../contexts/AuthContext";
import { FloatingField } from "../../components/FloatingField";

const BRAND = "#388E3C";

type LoginFormValues = {
  email: string;
  password: string;
};

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>();

  const onSubmit = async (data: LoginFormValues) => {
    setErrorMessage("");
    try {
      await login(data.email, data.password);
      navigate("/");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "로그인 실패");
    }
  };

  // 상자 아래에 보여줄 오류 한 줄: 이메일 → 비밀번호 → 서버 오류 순서로 첫 번째만
  const message = errors.email?.message || errors.password?.message || errorMessage;

  return (
    <div className="min-h-screen bg-white flex flex-col items-center px-4 pt-16 md:pt-24 pb-10">
      {/* ── 로고 ── */}
      <h1 className="text-4xl font-extrabold tracking-tight mb-10" style={{ color: BRAND }}>
        SafeBite
      </h1>

      <div className="w-full max-w-[460px]">
        {/* ── 로그인 판 ── */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="border border-gray-300 rounded-lg px-5 py-6 md:px-7 md:py-8 shadow-[0_5px_8px_0_rgba(68,68,68,0.04)]"
        >
          {/* 이메일 / 비밀번호: 밑줄 칸 + 떠오르는 이름표 (FloatingField) */}
          <div className="space-y-2">
            <FloatingField
              id="login-email"
              label="이메일"
              type="email"
              autoComplete="email"
              invalid={!!errors.email}
              registration={register("email", {
                required: "이메일을 입력해 주세요.",
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: "이메일 형식이 올바르지 않아요.",
                },
              })}
            />
            <FloatingField
              id="login-password"
              label="비밀번호"
              type="password"
              autoComplete="current-password"
              invalid={!!errors.password}
              registration={register("password", { required: "비밀번호를 입력해 주세요." })}
            />
          </div>

          {/* 오류 한 줄 */}
          {message && (
            <p role="alert" className="text-sm text-red-500 mt-3">
              {message}
            </p>
          )}

          {/* 로그인 버튼 */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-[52px] mt-6 rounded-md text-white text-lg font-bold transition-colors hover:brightness-95 disabled:opacity-60"
            style={{ backgroundColor: BRAND }}
          >
            {isSubmitting ? "로그인 중..." : "로그인"}
          </button>
        </form>

        {/* ── 판 아래 링크 ── */}
        <div className="flex justify-center mt-6 text-sm text-gray-500">
          <Link to="/signup" className="hover:underline">
            회원가입
          </Link>
        </div>
      </div>
      {/* 맨 아래 저작권 표시 (mt-auto 로 화면 아래쪽에 붙는다) */}
      <footer className="mt-auto pt-16 text-xs text-gray-400">© 2026 SafeBite</footer>
    </div>
  );
}
