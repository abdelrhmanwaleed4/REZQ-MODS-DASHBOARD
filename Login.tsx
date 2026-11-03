import { useEffect, useState, type FormEvent } from "react";
import { getSupabase, syncSupabaseSession } from "@/lib/supabase";
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";

const errorMessages: Record<string, string> = {
  google_not_configured: "تسجيل الدخول عبر Google غير مهيأ بعد. أضف بيانات OAuth في الأسرار الآمنة للمشروع.",
  google_state: "انتهت جلسة Google أو لم يتم التحقق منها. حاول مرة أخرى.",
  google_unverified: "تعذر التحقق من البريد من Google. استخدم حسابًا موثقًا.",
  google_failed: "لم يكتمل تسجيل الدخول عبر Google. حاول مرة أخرى.",
  account_banned: "هذا الحساب محظور نهائيًا من دخول الموقع.",
};

export default function Login({ revokedReason }: { revokedReason?: string | null }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => {
    const queryError = new URLSearchParams(window.location.search).get("error");
    return queryError ? errorMessages[queryError] ?? "تعذر إكمال تسجيل الدخول." : "";
  });

  // Supabase returns from Google OAuth to /login with the session in the URL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (revokedReason) {
          await getSupabase().auth.signOut(); // Never reissue a session ended by the stream or ban.
          return;
        }
        const { data } = await getSupabase().auth.getSession();
        if (!data.session || cancelled) return;
        const result = await syncSupabaseSession();
        if (!cancelled) window.location.replace(result.status === "pending" ? "/waiting-approval" : "/");
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "تعذر تأكيد الجلسة.");
      }
    })();
    return () => { cancelled = true; };
  }, [revokedReason]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const supabase = getSupabase();
      if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { name }, emailRedirectTo: `${window.location.origin}/login` },
        });
        if (error) throw error;
        if (!data.session) {
          setError("تم إرسال رابط تأكيد إلى بريدك. افتح الإيميل وأكّد الحساب قبل الدخول.");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      const result = await syncSupabaseSession();
      window.location.replace(result.status === "pending" ? "/waiting-approval" : "/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر الاتصال بخدمة تسجيل الدخول.");
    } finally {
      setBusy(false);
    }
  }

  async function startGoogleLogin() {
    setBusy(true); setError("");
    try {
      const { error } = await getSupabase().auth.signInWithOAuth({
        provider: "google", options: { redirectTo: `${window.location.origin}/login` },
      });
      if (error) throw error;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر بدء Google OAuth.");
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell" dir="rtl">
      <SiteHeader />
      <main className="auth-main">
        <div className="auth-visual" aria-hidden="true">
          <img src="/branding/rezk-login-banner.png" alt="" className="auth-visual-photo" fetchPriority="high" />
        </div>
        <img src="/branding/rezk-team-poster.jpg" alt="هوية فريق REZK الشيخ" className="auth-mobile-poster" />
        <section className="auth-card">
          <div className="eyebrow"><ShieldCheck size={15} /> بوابة إدارة المشرفين</div>
          <h1>{mode === "login" ? "مرحبًا بعودتك" : "أنشئ حسابك"}</h1>
          <p className="auth-subtitle">إدارة فريق البث تبدأ من هنا. الحسابات الجديدة تنتظر موافقة الإدارة.</p>
          {revokedReason === "stream-ended" && <div className="notice notice-cyan">انتهى البث المباشر وتم تسجيل خروج جميع المستخدمين. سجّل الدخول مجددًا عند الحاجة.</div>}
          {revokedReason === "banned" && <div className="notice notice-red">تم حظر هذا الحساب نهائيًا من الموقع.</div>}
          {revokedReason === "session-revoked" && <div className="notice notice-cyan">تم إلغاء هذه الجلسة بواسطة الإدارة. سجّل الدخول من جديد.</div>}
          {error && <div className="notice notice-red" role="alert">{error}</div>}
          <button className="google-button" onClick={() => void startGoogleLogin()} type="button">
            <span className="google-g">G</span><span>المتابعة باستخدام Google</span><ArrowLeft size={16} />
          </button>
          <div className="divider"><span>أو باستخدام البريد الإلكتروني</span></div>
          <div className="auth-tabs" role="tablist">
            <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }} type="button">تسجيل الدخول</button>
            <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }} type="button">إنشاء حساب</button>
          </div>
          <form onSubmit={submit} className="auth-form">
            {mode === "register" && <label className="field-label">الاسم الظاهر<div className="input-wrap"><UserRound size={17} /><input autoComplete="name" required value={name} onChange={event => setName(event.target.value)} placeholder="اسمك" /></div></label>}
            <label className="field-label">البريد الإلكتروني<div className="input-wrap" dir="ltr"><Mail size={17} /><input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" /></div></label>
            <label className="field-label">كلمة المرور<div className="input-wrap" dir="ltr"><LockKeyhole size={17} /><input type={showPassword ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={10} required value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === "register" ? "10 أحرف على الأقل" : "••••••••••"} /><button className="icon-button" type="button" aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
            {mode === "register" && <p className="form-hint">سيظل الحساب الجديد بانتظار الموافقة حتى يفعّله أحد المشرفين. للحصول على صلاحية المدير الأولى، استخدم حساب Google الموثق المخصص للمالك.</p>}
            <button className="primary-button full-width" disabled={busy} type="submit">{busy ? "جارٍ المعالجة…" : mode === "login" ? "دخول آمن" : "إنشاء الحساب"}<ArrowLeft size={17} /></button>
          </form>
          <div className="auth-footer"><LockKeyhole size={13} /> اتصال آمن · لا نعرض كلمات المرور أو مفاتيح البوت في المتصفح</div>
        </section>
      </main>
      <footer className="site-footer"><span>REZK MODS</span><span>بوابة مشرفي البث · © 2026</span></footer>
    </div>
  );
}
