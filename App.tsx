import { useEffect } from "react";
import { getSupabase } from "@/lib/supabase";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import Login from "./pages/Login";
import Portal from "./pages/Portal";
import WaitingApproval from "./pages/WaitingApproval";
import NotFound from "./pages/NotFound";
import { MfaChallenge } from "./pages/ExtendedPages";

function Loading({ label = "جارٍ التحقق من الجلسة…" }: { label?: string }) {
  return <main className="loading-screen" dir="rtl"><div className="loading-mark"><span /></div><strong>{label}</strong><small>REZK MODS · SECURE ACCESS</small></main>;
}

function ErrorScreen({ retry }: { retry: () => void }) {
  return <main className="loading-screen" dir="rtl"><div className="notice notice-red">تعذر الاتصال بالخادم. تحقق من إعداد قاعدة البيانات ثم أعد المحاولة.</div><button className="primary-button" onClick={retry}>إعادة المحاولة</button></main>;
}

export default function App() {
  const [location, setLocation] = useLocation();
  const auth = trpc.auth.snapshot.useQuery(undefined, { retry: false, refetchInterval: 5_000, refetchIntervalInBackground: true });
  const user = auth.data?.user;

  useEffect(() => {
    if (user?.status === "approved" && !user.mfaRequired && (location === "/waiting-approval" || location === "/login")) setLocation("/");
    if (user?.status === "pending" && location !== "/waiting-approval") setLocation("/waiting-approval");
  }, [user?.status, location, setLocation]);

  async function logout() {
    try { await getSupabase().auth.signOut(); } finally { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); window.location.assign("/login"); }
  }

  if (auth.isLoading) return <Loading />;
  if (auth.error) return <ErrorScreen retry={() => void auth.refetch()} />;
  if (!user) return <Login revokedReason={auth.data?.sessionRevokedReason} />;
  if (user.status === "banned") return <Login revokedReason="banned" />;
  if (user.mfaRequired) return <MfaChallenge />;
  if (user.status === "pending") return <WaitingApproval email={user.email} onLogout={logout} />;
  if (location === "/404") return <NotFound />;
  return <Portal user={user} onLogout={logout} />;
}
