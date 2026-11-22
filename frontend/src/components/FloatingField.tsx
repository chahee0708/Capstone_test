/**
 * FloatingField.tsx
 *
 * 역할: 밑줄 입력칸 + 떠오르는 이름표 (네이버 로그인처럼)
 *   - 비어 있고 누르지 않았을 때: 이름표("이메일")가 칸 가운데에 안내 글자처럼 보인다
 *   - 누르거나 글자가 있을 때: 이름표가 작아지며 칸 위쪽으로 올라가고, 글자는 그 아래에 입력된다
 *   - 밑줄: 평소 회색, 누르면 테마색(#388E3C), 이 칸에 오류가 있으면 빨강
 *   - 이름표도 누른 동안 테마색
 *   - suffix 를 주면 오른쪽 끝에 단위를 작게 붙인다 (예: "kg", "mg/dL")
 *
 * 쓰이는 곳:
 *   - LoginPage.tsx, SignupPage.tsx: react-hook-form 의 register(...) 결과를 registration 으로
 *   - ProfilePage.tsx: 일반 상태값을 value / onChange 로
 *
 * 원리: input 에 placeholder=" " (공백 한 칸)을 넣어 두고, 글자가 없으면 :placeholder-shown 이 참이 된다.
 *       group-focus-within(밑줄과 같은 기준) / peer-[:not(:placeholder-shown)] 로 이름표 위치·크기를 바꾼다 (CSS 만으로)
 *       브라우저 자동 완성으로 값이 들어가도 :placeholder-shown 이 거짓이 되어 이름표가 위로 올라간다
 */
import type { HTMLAttributes } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

type Props = {
  id: string;
  label: string; // 이름표 (예: "이메일")
  type?: string;
  autoComplete?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  invalid?: boolean; // 이 칸에 오류가 있으면 밑줄 빨강
  suffix?: string; // 오른쪽 끝 단위 (예: "kg")
  // react-hook-form 으로 쓸 때
  registration?: UseFormRegisterReturn;
  // 일반 상태값으로 쓸 때
  value?: string | number;
  onChange?: (value: string) => void;
};

export function FloatingField({
  id, label, type = "text", autoComplete, inputMode, invalid, suffix, registration, value, onChange,
}: Props) {
  // 숫자 칸의 위아래 화살표(스핀 버튼)는 숨긴다
  const noSpin =
    type === "number"
      ? " [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      : "";
  const controlled = registration
    ? registration
    : { value: value ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value) };

  return (
    <div
      className={`group relative h-14 border-b transition-colors focus-within:border-[#388E3C] ${
        invalid ? "border-red-400" : "border-gray-300"
      }`}
    >
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder=" "
        aria-invalid={invalid}
        className={`peer absolute left-1 bottom-1.5 h-7 bg-transparent text-base text-gray-900 focus:outline-none ${
          suffix ? "right-14" : "right-1"
        }${noSpin}`}
        {...controlled}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-base text-gray-400 transition-all duration-150
          group-focus-within:top-2.5 group-focus-within:text-xs group-focus-within:text-[#388E3C]
          peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:text-xs"
      >
        {label}
      </label>
      {suffix && (
        <span className="pointer-events-none absolute right-1 bottom-2 text-sm text-gray-400">{suffix}</span>
      )}
    </div>
  );
}
