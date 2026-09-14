import { Home, RotateCcw } from "lucide-react";
import { Link } from "react-router";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-xl p-10 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
          <Home className="h-8 w-8" />
        </div>
        <div className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-600">
          SafeBite
        </div>
        <h1 className="mt-4 text-4xl font-black text-slate-900">404</h1>
        <p className="mt-3 text-lg font-semibold text-slate-700">
          찾으시는 페이지가 없습니다.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          URL을 확인하거나 홈으로 돌아가세요.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
            <Link to="/">
              <Home className="w-4 h-4 mr-2" /> 홈으로
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/signup-detail">
              <RotateCcw className="w-4 h-4 mr-2" /> 회원가입 입력
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
