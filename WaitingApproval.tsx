import { Clock3, LogOut, ShieldCheck } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";

export default function WaitingApproval({ email, onLogout }: { email?: string | null; onLogout: () => void }) {
  return (
    <div className="auth-shell" dir="rtl">
      <SiteHeader email={email} onLogout={onLogout} />
      <main className="waiting-main">
        <section className="waiting-card">
          <img src="/branding/rezk-team-poster.jpg" alt="REZK الشيخ" className="waiting-brand-poster" />
          <div className="waiting-emblem"><Clock3 size={30} /></div>
          <div className="eyebrow"><ShieldCheck size={15} /> مراجعة الوصول</div>
          <h1>حسابك بانتظار الموافقة</h1>
          <p>تم إنشاء حسابك بنجاح. سيظهر لك المحتوى الإداري بعد اعتماد حسابك من أحد المشرفين.</p>
          {email && <div className="account-email" dir="ltr">{email}</div>}
          <div className="approval-steps"><span className="step-done">١ <b>إنشاء الحساب</b></span><i /><span className="step-current">٢ <b>مراجعة الإدارة</b></span><i /><span>٣ <b>الدخول للبوابة</b></span></div>
          <button className="secondary-button" onClick={onLogout}><LogOut size={16} /> تسجيل الخروج</button>
        </section>
      </main>
      <footer className="site-footer"><span>REZK MODS</span><span>تظهر الموافقة تلقائيًا عند تحديث حالة الحساب</span></footer>
    </div>
  );
}
