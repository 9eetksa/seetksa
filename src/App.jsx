import { PlatformProvider } from "./admin/platform";
import React, { lazy, Suspense } from "react";

const Editor = lazy(() => import("./admin/Editor"));
const Portal = lazy(() => import("./auth/Portal"));
const Studio = lazy(() => import("./Studio"));
const portalPaths = [
  '/change-password',
  "/login",
  "/forgot-password",
  "/reset-password",
  "/employee/dashboard",
  "/admin/dashboard",
  "/admin/workspace",
];

function Routes({path, recovery}) {
  if (path === '/client' || path.startsWith('/client/')) return <main className="a-loading" dir="rtl"><section><h1>هذه الصفحة غير متاحة</h1><p>تدار الطلبات في صيت عبر المشرف المسؤول</p><a href="/login">دخول الفريق</a></section></main>;
  if (path === "/admin/editor")
    return (
      <Suspense fallback={<div>جار تحميل المحرر</div>}>
        <Editor />
      </Suspense>
    );
  return portalPaths.includes(path) || recovery ? (
    <Suspense
      fallback={
        <div className="s-site" role="status" dir="rtl">
          جار تحميل بوابتك
        </div>
      }
    >
      <Portal initialPath={recovery ? "/reset-password" : path} />
    </Suspense>
  ) : (
    <Suspense fallback={<div className="s-site" role="status" dir="rtl">جار تحميل الموقع</div>}>
      <Studio />
    </Suspense>
  );
}

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  // Keep recovery callbacks routed to the password reset flow
  const recovery = /(?:^|[&#])type=recovery(?:&|$)/.test(window.location.hash);
  return (
    <PlatformProvider>
      <Routes path={path} recovery={recovery} />
    </PlatformProvider>
  );
}
