import { createBrowserRouter, redirect } from "react-router";
import { RootLayout } from "./components/RootLayout";
import { HomePage } from "./pages/HomePage";
import { FoodAnalysisPage } from "./pages/FoodAnalysisPage";
import { ProfilePage } from "./pages/ProfilePage";
import { LoginPage } from "./pages/LoginPage";

function requireAuth() {
  if (!localStorage.getItem("userId")) {
    return redirect("/login");
  }
  return null;
}

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: LoginPage,
  },
  {
    path: "/",
    Component: RootLayout,
    loader: requireAuth,
    children: [
      { index: true, Component: HomePage },
      { path: "analysis", Component: FoodAnalysisPage },
      { path: "profile", Component: ProfilePage },
    ],
  },
]);
