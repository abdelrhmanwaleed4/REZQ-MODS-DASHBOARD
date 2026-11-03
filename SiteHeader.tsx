import { ExternalLink, Radio } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function SiteHeader({ email, onLogout }: { email?: string | null; onLogout?: () => void }) {
  const status = trpc.stream.status.useQuery(undefined, { refetchInterval: 8_000, retry: false });
  const live = status.data?.isLive ?? false;
  const connected = status.data?.connected ?? false;
  const configured = status.data?.configured ?? false;
  const streamLabel = live ? "البث مباشر" : !configured ? "حالة البث غير متصلة" : connected ? "البث غير مباشر" : "جاري إعادة الاتصال";
  return (
    <header className="site-header" dir="rtl">
      <a className="brand-lockup" href="/" aria-label="Kick REZK MODS home">
        <span className="brand-mark"><img src="/branding/rezk-logo.png" alt="" width="37" height="37" decoding="async" /></span>
        <span className="brand-wordmark"><b>REZK</b><small>MODERATION / LIVE OPS</small></span>
      </a>
      <div className="header-right">
        <div className={`live-pill ${live ? "is-live" : ""}`} role="status">
          <span className={`status-dot ${live ? "pulse" : ""}`} />
          <Radio size={15} />
          <span>{streamLabel}</span>
          {live && <strong>{status.data?.badge ?? "LIVE"}</strong>}
        </div>
        <a className="kick-link" href="https://kick.com/es_hisham" target="_blank" rel="noreferrer noopener">
          <span>افتح قناة Kick</span><ExternalLink size={14} />
        </a>
        {email && <span className="header-email" dir="ltr">{email}</span>}
        {onLogout && <button className="text-button" onClick={onLogout}>تسجيل الخروج</button>}
      </div>
    </header>
  );
}
