import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, Link } from "react-router";
import { Heart, Mail, Lock, User } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { useAuth } from "../../contexts/AuthContext";
import {
  SignupOcrPanel,
  SignupPersonalInfoSection,
  SignupHealthConditionsSection,
  SignupAllergySection,
  emptyProfile,
  toProfilePayload,
} from "../components/signup/SignupDetailSections";

type SignupFormValues = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export function SignupPage() {
  const { user, register: authRegister } = useAuth();
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState("");
  const [profile, setProfile] = useState(emptyProfile);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<string>("이미지 미선택");

  // 이미 로그인된 상태로 /signup 에 들어오면 홈으로 보낸다.
  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>();

  const password = watch("password");

  // 가입과 동시에 건강 프로필을 서버에 저장한다. (비밀번호 등 가입 정보는 브라우저 저장소에 남기지 않는다)
  const submit = async (data: SignupFormValues, withProfile: boolean) => {
    setErrorMessage("");
    try {
      await authRegister(
        data.name,
        data.email,
        data.password,
        withProfile ? toProfilePayload(profile) : undefined,
      );
      // 가입 직후 로그인된 상태이므로 바로 홈으로 이동한다.
      navigate("/");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "회원가입 실패");
    }
  };

  const onSubmit = (data: SignupFormValues) => submit(data, true);

  // "나중에 입력할게요": 건강 정보 없이 계정만 먼저 만든다. 프로필 화면에서 언제든 입력할 수 있다.
  const onSkipDetails = (data: SignupFormValues) => submit(data, false);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Heart className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">SafeBite</h1>
          <p className="text-body mt-1">건강한 식습관의 시작</p>
        </div>

        <Card className="p-8">
          <h2 className="text-xl font-semibold mb-6">회원가입</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="name">이름</Label>
              <div className="relative mt-1">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mute" />
                <Input
                  id="name"
                  type="text"
                  placeholder="이름을 입력하세요"
                  className="pl-9"
                  {...register("name", {
                    required: "이름을 입력해주세요",
                    minLength: { value: 2, message: "이름은 2자 이상이어야 합니다" },
                  })}
                />
              </div>
              {errors.name && (
                <p className="text-negative-deep text-xs mt-1">{errors.name.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="email">이메일</Label>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mute" />
                <Input
                  id="email"
                  type="email"
                  placeholder="example@email.com"
                  className="pl-9"
                  {...register("email", {
                    required: "이메일을 입력해주세요",
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: "올바른 이메일 형식이 아닙니다",
                    },
                  })}
                />
              </div>
              {errors.email && (
                <p className="text-negative-deep text-xs mt-1">{errors.email.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="password">비밀번호</Label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mute" />
                <Input
                  id="password"
                  type="password"
                  placeholder="8자 이상 입력하세요"
                  className="pl-9"
                  {...register("password", {
                    required: "비밀번호를 입력해주세요",
                    minLength: { value: 8, message: "비밀번호는 8자 이상이어야 합니다" },
                  })}
                />
              </div>
              {errors.password && (
                <p className="text-negative-deep text-xs mt-1">{errors.password.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="confirmPassword">비밀번호 확인</Label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mute" />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="비밀번호를 다시 입력하세요"
                  className="pl-9"
                  {...register("confirmPassword", {
                    required: "비밀번호 확인을 입력해주세요",
                    validate: (value) =>
                      value === password || "비밀번호가 일치하지 않습니다",
                  })}
                />
              </div>
              {errors.confirmPassword && (
                <p className="text-negative-deep text-xs mt-1">{errors.confirmPassword.message}</p>
              )}
            </div>

            <div className="mt-6">
              <SignupOcrPanel
                profile={profile}
                setProfile={setProfile}
                selectedImage={selectedImage}
                setSelectedImage={setSelectedImage}
                ocrStatus={ocrStatus}
                setOcrStatus={setOcrStatus}
              />
            </div>

            <div className="mt-6">
              <SignupPersonalInfoSection profile={profile} setProfile={setProfile} />
            </div>

            <div className="mt-6">
              <SignupHealthConditionsSection profile={profile} setProfile={setProfile} />
            </div>

            <div className="mt-6">
              <SignupAllergySection profile={profile} setProfile={setProfile} />
            </div>

            {errorMessage && (
              <div className="p-3 bg-negative/10 border border-negative/30 rounded-lg text-negative-deep text-sm">
                {errorMessage}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? "가입 중..." : "회원가입"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={isSubmitting}
                onClick={handleSubmit(onSkipDetails)}
              >
                나중에 입력할게요
              </Button>
            </div>
          </form>

          <p className="text-center text-sm text-body mt-6">
            이미 계정이 있으신가요?{" "}
            <Link to="/login" className="text-positive-deep font-medium hover:underline">
              로그인
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
