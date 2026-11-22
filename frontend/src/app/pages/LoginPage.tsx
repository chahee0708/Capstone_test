import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, Link } from "react-router";
import { Heart } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { useAuth } from "../../contexts/AuthContext";
import { FloatingField } from "../../components/FloatingField";

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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Heart className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">SafeBite</h1>
          <p className="text-gray-500 mt-1">건강한 식습관의 시작</p>
        </div>

        <Card className="p-8">
          <h2 className="text-xl font-semibold mb-6">로그인</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* [변경] 입력칸: 밑줄 + 떠오르는 이름표 (FloatingField, seohee 브랜치 형식) */}
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
                label="비밀번호"
                type="password"
                autoComplete="current-password"
                invalid={!!errors.password}
                registration={register("password", {
                  required: "비밀번호를 입력해주세요",
                })}
              />
              {errors.password && (
                <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
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
              {isSubmitting ? "로그인 중..." : "로그인"}
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            계정이 없으신가요?{" "}
            <Link to="/signup" className="text-emerald-600 font-medium hover:underline">
              회원가입
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
