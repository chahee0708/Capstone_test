import { createBrowserRouter } from "react-router";
import { RootLayout } from "./components/RootLayout";
import { HomePage } from "./pages/HomePage";
import { FoodAnalysisPage } from "./pages/FoodAnalysisPage";
import { ProfilePage } from "./pages/ProfilePage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { SignupDetailFlowPage } from "./pages/SignupDetailFlowPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: LoginPage,
  },
  {
    path: "/signup",
    Component: SignupPage,
  },
  {
    path: "/signup-detail",
    Component: SignupDetailFlowPage,
  },
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: HomePage },
      { path: "analysis", Component: FoodAnalysisPage },
      { path: "profile", Component: ProfilePage },
    ],
  },
  {
    path: "*",
    Component: NotFoundPage,
  },
]);