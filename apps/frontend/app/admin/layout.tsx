"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { AdminAuthProvider, useAdminAuth } from "@/lib/auth/auth-context";

/**
 * Wraps every /admin/* route with the auth provider + a client-side guard.
 *
 * - /admin/login is always reachable (unauthenticated users land here).
 * - Every other /admin route requires an authenticated admin. While we are
 *   still checking storage we show a minimal loading state so there is no
 *   flash of admin UI that would then 401.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminGuard>{children}</AdminGuard>
    </AdminAuthProvider>
  );
}

function AdminGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { status } = useAdminAuth();

  const isLogin = pathname === "/admin/login";

  useEffect(() => {
    if (!isLogin && status === "unauthenticated") {
      router.replace("/admin/login");
    }
  }, [status, isLogin, router]);

  if (isLogin) return <>{children}</>;

  if (status === "idle") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FDF8EC",
          color: "#A89883",
          fontFamily: "var(--font-oswald), monospace",
          fontSize: 11,
          letterSpacing: 3,
          textTransform: "uppercase",
        }}
      >
        Verificando sesión...
      </div>
    );
  }

  if (status === "unauthenticated") {
    // The useEffect above is routing us away; render nothing in the
    // meantime to avoid a flash of the admin dashboard.
    return null;
  }

  return <>{children}</>;
}
