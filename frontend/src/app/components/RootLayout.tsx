import { useEffect } from "react";
import { Outlet, Link, useLocation, Navigate } from "react-router";
import { Home, ScanBarcode, User, Heart, LogOut } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const NAV_ITEMS = [
  { path: "/", icon: Home, label: "홈", title: "홈" },
  { path: "/analysis", icon: ScanBarcode, label: "분석", title: "식품 분석" },
  { path: "/profile", icon: User, label: "프로필", title: "건강 프로필" },
];

export function RootLayout() {
  const location = useLocation();
  const { user, logout } = useAuth();

  // 화면 이동 시 탭 제목을 갱신한다 (브라우저 기록/접근성)
  useEffect(() => {
    const current = NAV_ITEMS.find((item) =>
      item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path),
    );
    document.title = current ? `${current.title} - SafeBite` : "SafeBite - 스마트 식품 분석";
  }, [location.pathname]);

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-gray-900 focus:px-4 focus:py-2 focus:text-white"
      >
        본문으로 건너뛰기
      </a>

      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-2" aria-label="SafeBite 홈">
              <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-blue-500 rounded-lg flex items-center justify-center">
                <Heart className="w-5 h-5 text-white" aria-hidden="true" />
              </div>
              <span className="font-semibold text-lg">SafeBite</span>
            </Link>

            <nav className="hidden md:flex items-center gap-6" aria-label="주 메뉴">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                      active ? "bg-emerald-50 text-emerald-600" : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                    <span className="text-sm">{item.label}</span>
                  </Link>
                );
              })}
              <button
                type="button"
                onClick={logout}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span className="text-sm">로그아웃</span>
              </button>
            </nav>

            {/* 모바일: 하단 메뉴에는 로그아웃이 없으므로 헤더에 둔다 */}
            <button
              type="button"
              onClick={logout}
              className="md:hidden flex items-center gap-1.5 h-11 px-3 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              aria-label="로그아웃"
            >
              <LogOut className="w-5 h-5" aria-hidden="true" />
              <span className="text-sm">로그아웃</span>
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1" tabIndex={-1}>
        <Outlet />
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden bg-white border-t border-gray-200 sticky bottom-0 z-50" aria-label="하단 메뉴">
        <div className="flex items-center justify-around">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-3 px-4 flex-1 ${
                  active ? "text-emerald-600" : "text-gray-600"
                }`}
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                <span className="text-xs">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
