/**
 * SignupPage.tsx
 *
 * 역할: 회원가입 화면 (/signup)
 *
 * 디자인: 로그인 화면(LoginPage)과 같은 모양 (네이버 로그인과 비슷한 배치, 로고·색은 SafeBite 것)
 *   - 흰 바탕, 위쪽 가운데 SafeBite 글자 (테마색)
 *   - 테두리 있는 판 하나 안에
 *       이름 / 이메일 / 비밀번호 / 비밀번호 확인 칸은 상자 없이 밑줄만 + 떠오르는 이름표 (FloatingField: 누르면 이름표가 작아지며 위로, 밑줄은 테마색, 오류 칸은 빨강)
 *       입력 오류는 상자 바로 아래 빨간 글씨 한 줄 (위 칸부터 첫 번째 오류만)
 *       큰 테마색 회원가입 버튼
 *   - 판 아래 작은 회색 링크: 로그인
 *   - 화면 맨 아래 작은 회색 "© 2026 SafeBite"
 *   검사 규칙은 예전과 같다: 이름 2자 이상, 이메일 형식, 비밀번호 8자 이상, 비밀번호 확인 일치
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, Link } from "react-router";
import { useAuth } from "../../contexts/AuthContext";
import { FloatingField } from "../../components/FloatingField";

const BRAND = "#388E3C";

type SignupFormValues = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export function SignupPage() {
  const { register: authRegister } = useAuth();
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState("");

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>();

  const password = watch("password");

  const onSubmit = async (data: SignupFormValues) => {
    setErrorMessage("");
    try {
      await authRegister(data.name, data.email, data.password);
      navigate("/login");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "회원가입 실패");
    }
  };

  // 상자 아래 오류 한 줄: 위 칸부터 첫 번째 → 서버 오류
  const message =
    errors.name?.message ||
    errors.email?.message ||
    errors.password?.message ||
    errors.confirmPassword?.message ||
    errorMessage;

  return (
    <div className="min-h-screen bg-white flex flex-col items-center px-4 pt-16 md:pt-24 pb-10">
      {/* ── 로고 ── */}
      <h1 className="text-4xl font-extrabold tracking-tight mb-10" style={{ color: BRAND }}>
        SafeBite
      </h1>

      <div className="w-full max-w-[460px]">
        {/* ── 회원가입 판 ── */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="border border-gray-300 rounded-lg px-5 py-6 md:px-7 md:py-8 shadow-[0_5px_8px_0_rgba(68,68,68,0.04)]"
        >
          {/* 네 칸: 밑줄 칸 + 떠오르는 이름표 (FloatingField) */}
          <div className="space-y-2">
            <FloatingField
              id="signup-name"
              label="이름"
              autoComplete="name"
              invalid={!!errors.name}
              registration={register("name", {
                required: "이름을 입력해 주세요.",
                minLength: { value: 2, message: "이름은 2자 이상이어야 해요." },
              })}
            />
            <FloatingField
              id="signup-email"
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
              id="signup-password"
              label="비밀번호 (8자 이상)"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.password}
              registration={register("password", {
                required: "비밀번호를 입력해 주세요.",
                minLength: { value: 8, message: "비밀번호는 8자 이상이어야 해요." },
              })}
            />
            <FloatingField
              id="signup-password-confirm"
              label="비밀번호 확인"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.confirmPassword}
              registration={register("confirmPassword", {
                required: "비밀번호 확인을 입력해 주세요.",
                validate: (value) => value === password || "비밀번호가 일치하지 않아요.",
              })}
            />
          </div>

          {/* 오류 한 줄 */}
          {message && (
            <p role="alert" className="text-sm text-red-500 mt-3">
              {message}
            </p>
          )}

          {/* 회원가입 버튼 */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-[52px] mt-6 rounded-md text-white text-lg font-bold transition-colors hover:brightness-95 disabled:opacity-60"
            style={{ backgroundColor: BRAND }}
          >
            {isSubmitting ? "가입 중..." : "회원가입"}
          </button>
        </form>

        {/* ── 판 아래 링크 ── */}
        <div className="flex justify-center mt-6 text-sm text-gray-500">
          <Link to="/login" className="hover:underline">
            로그인
          </Link>
        </div>
      </div>
      {/* 맨 아래 저작권 표시 (mt-auto 로 화면 아래쪽에 붙는다) */}
      <footer className="mt-auto pt-16 text-xs text-gray-400">© 2026 SafeBite</footer>
    </div>
  );
}
