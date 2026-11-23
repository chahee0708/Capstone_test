/**
 * SignupPage.tsx
 *
 * 역할: 회원가입 화면. 가입하면 바로 로그인된 상태가 된다 (AuthContext.register)
 *
 * 이번에 바뀐 점:
 *   - [변경] 가입 후 로그인 화면 대신 프로필(건강 정보 탭)로 보낸다
 *       이미 로그인된 상태인데 로그인 화면으로 보내서 다시 로그인해야 했고,
 *       나이·몸무게·키를 넣기 전에는 분석할 수 없으므로 (백엔드 PROFILE_INCOMPLETE)
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, Link } from "react-router";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { useAuth } from "../../contexts/AuthContext";
import { FloatingField } from "../../components/FloatingField";

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
      // [변경] 가입하면 이미 로그인된 상태 → 건강 정보부터 입력하게 프로필로
      toast.success("가입이 완료되었습니다", { description: "건강 정보를 먼저 입력해 주세요" });
      navigate("/profile", { state: { tab: "health" } });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "회원가입 실패");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Heart className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Before you Bite</h1>
          <p className="text-gray-500 mt-1">건강한 식습관의 시작</p>
        </div>

        <Card className="p-8">
          <h2 className="text-xl font-semibold mb-6">회원가입</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* [변경] 입력칸: 밑줄 + 떠오르는 이름표 (FloatingField, seohee 브랜치 형식) */}
            <div>
              <FloatingField
                id="name"
                label="이름"
                autoComplete="name"
                invalid={!!errors.name}
                registration={register("name", {
                  required: "이름을 입력해주세요",
                  minLength: { value: 2, message: "이름은 2자 이상이어야 합니다" },
                })}
              />
              {errors.name && (
                <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>
              )}
            </div>

            <div>
              <FloatingField
                id="email"
                label="이메일"
                type="email"
                autoComplete="email"
                invalid={!!errors.email}
                registration={register("email", {
                  required: "이메일을 입력해주세요",
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: "올바른 이메일 형식이 아닙니다",
                  },
                })}
              />
              {errors.email && (
                <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
              )}
            </div>

            <div>
              <FloatingField
                id="password"
                label="비밀번호 (8자 이상)"
                type="password"
                autoComplete="new-password"
                invalid={!!errors.password}
                registration={register("password", {
                  required: "비밀번호를 입력해주세요",
                  minLength: { value: 8, message: "비밀번호는 8자 이상이어야 합니다" },
                })}
              />
              {errors.password && (
                <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
              )}
            </div>

            <div>
              <FloatingField
                id="confirmPassword"
                label="비밀번호 확인"
                type="password"
                autoComplete="new-password"
                invalid={!!errors.confirmPassword}
                registration={register("confirmPassword", {
                  required: "비밀번호 확인을 입력해주세요",
                  validate: (value) =>
                    value === password || "비밀번호가 일치하지 않습니다",
                })}
              />
              {errors.confirmPassword && (
                <p className="text-red-500 text-xs mt-1">{errors.confirmPassword.message}</p>
              )}
            </div>

            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {errorMessage}
              </div>
            )}

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              {isSubmitting ? "가입 중..." : "회원가입"}
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            이미 계정이 있으신가요?{" "}
            <Link to="/login" className="text-emerald-600 font-medium hover:underline">
              로그인
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
