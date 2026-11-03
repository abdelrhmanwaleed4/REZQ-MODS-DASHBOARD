import { useMemo, useState, type FormEvent } from "react";
import { Activity, ArrowDownLeft, ArrowUpLeft, BadgeCheck, Ban, Check, ChevronDown, CircleHelp, Clock3, CalendarDays, Star, ShieldAlert, BarChart3, Crown, ExternalLink, Eye, KeyRound, LayoutDashboard, LockKeyhole, Plus, Radio, RefreshCw, Save, Settings2, Shield, ShieldCheck, Trash2, UserCheck, UserRound, Users, X, Bot } from "lucide-react";
import { useLocation } from "wouter";
import { AttendancePage, PointsPage, AbsencesPage, DisciplinePage, ReportsPage } from "./StaffOperations";
import { VoiceRoomsPage, NotificationsPage, IncidentsPage, AcademyPage, PerformancePage, AuditPage, AdminSettingsPage, SecurityPage, KickCenterPage } from "./ExtendedPages";
import { trpc } from "@/lib/trpc";
import { ModerationPage, AutoModPage, AppealsPage, AnalyticsPage, KnowledgePage, AnnouncementsPage, StaffChatPage, BookmarksPage, AutomationPage, AccountsPage, BackupPage, ApprovalsPage, TempVoicePage, RewardsPage } from "./AdvancedOpsPages";
import { BookOpen, MessageCircle, Zap, Headphones, ClipboardCheck, Gift, CloudDownload, Link2, BellRing } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import type { SafeUser } from "../../../server/_core/appAuth";

const permissionChoices = [
  { id: "manageRanks", label: "Manage Ranks", note: "تحرير الصلاحيات وتعيين الرتب أو إزالتها" },
  { id: "manageUsers", label: "Manage Users", note: "الموافقة على الحسابات والحظر الدائم" },
  { id: "manageDiscord", label: "Manage Discord Bot", note: "إعداد تكامل بوت Discord" },
  { id: "manageAttendance", label: "Manage Attendance", note: "عرض الحضور وساعات أعضاء الفريق" },
  { id: "managePoints", label: "Manage Points", note: "إضافة نقاط المهام وتصحيحها" },
  { id: "manageLeaves", label: "Manage Leave", note: "قبول أو رفض الإجازات والأعذار" },
  { id: "manageDiscipline", label: "Manage Discipline", note: "تسجيل المخالفات وإلغاؤها" },
  { id: "createVoiceRooms", label: "Create Voice Rooms", note: "إنشاء رومات صوتية في Discord" },
  { id: "deleteVoiceRooms", label: "Delete Voice Rooms", note: "حذف الرومات التي أنشأها الموقع فقط" },
  { id: "manageVoiceRooms", label: "Manage Voice Rooms", note: "تعديل وقفل وفتح الرومات الصوتية" },
  { id: "manageReports", label: "Manage Reports", note: "مراجعة البلاغات السرية وإغلاقها" },
  { id: "manageAcademy", label: "Manage Academy", note: "إدارة امتحانات المودات" },
  { id: "viewAudit", label: "View Audit Log", note: "عرض سجل التعديلات الإدارية" },
  { id: "viewReports", label: "View Reports", note: "عرض تقارير الأداء الأسبوعية والشهرية" },
  { id: "manageModeration", label: "Moderation Center", note: "إنشاء ومراجعة سجلات الموديريشن" },
  { id: "manageAutoMod", label: "AutoMod Rules", note: "قواعد حماية الشات الموثوق" },
  { id: "reviewAppeals", label: "Review Appeals", note: "مراجعة استئنافات العقوبات" },
  { id: "manageKnowledge", label: "Knowledge Base", note: "إدارة دليل المودات" },
  { id: "manageAnnouncements", label: "Announcements", note: "نشر إعلانات الفريق وقراءة التأكيدات" },
  { id: "manageAutomations", label: "Automations", note: "إدارة قواعد الأتمتة" },
  { id: "manageBookmarks", label: "Stream Bookmarks", note: "تسجيل علامات اللايف" },
  { id: "manageRewards", label: "Kick Rewards", note: "مراجعة طلبات المكافآت" },
] as const;

const navItems = [
  { path: "/", title: "نظرة عامة", icon: LayoutDashboard },
  { path: "/ranks", title: "الرتب والصلاحيات", icon: Shield, permission: "manageRanks" },
  { path: "/users", title: "إدارة المستخدمين", icon: Users, permission: "manageUsers" },
  { path: "/discord", title: "إعداد Discord", icon: Settings2, permission: "manageDiscord" },
  { path: "/attendance", title: "الحضور والانصراف", icon: Clock3 },
  { path: "/points", title: "النقاط والترقيات", icon: Star },
  { path: "/absences", title: "الأعذار والإجازات", icon: CalendarDays },
  { path: "/discipline", title: "المخالفات والإنذارات", icon: ShieldAlert },
  { path: "/reports", title: "التقارير والأداء", icon: BarChart3, permission: "viewReports" },
  { path: "/performance", title: "التقييم والترتيب", icon: Activity },
  { path: "/voice", title: "الرومات الصوتية", icon: Radio },
  { path: "/kick", title: "مركز Kick", icon: Radio, permission: "viewReports" },
  { path: "/incidents", title: "البلاغات", icon: ShieldAlert },
  { path: "/academy", title: "أكاديمية المودات", icon: BadgeCheck },
  { path: "/notifications", title: "الإشعارات", icon: CircleHelp },
  { path: "/security", title: "أمان حسابي", icon: LockKeyhole },
  { path: "/audit", title: "سجل التعديلات", icon: Eye, permission: "viewAudit" },
  { path: "/moderation-center", title: "مركز الموديريشن", icon: ShieldAlert, permission: "manageModeration" },
  { path: "/automod", title: "AutoMod", icon: Bot, permission: "manageAutoMod" },
  { path: "/appeals", title: "الاستئنافات", icon: ShieldCheck },
  { path: "/analytics", title: "تحليلات البث", icon: Activity, permission: "viewReports" },
  { path: "/knowledge", title: "دليل المودات", icon: BookOpen },
  { path: "/announcements", title: "إعلانات الإدارة", icon: BellRing },
  { path: "/chat", title: "شات الإدارة", icon: MessageCircle },
  { path: "/bookmarks", title: "علامات اللايف", icon: Clock3 },
  { path: "/automations", title: "الأتمتة", icon: Zap, permission: "manageAutomations" },
  { path: "/temp-voice", title: "الرومات المؤقتة", icon: Headphones },
  { path: "/accounts", title: "ربط الحسابات", icon: Link2 },
  { path: "/rewards", title: "مكافآت Kick", icon: Gift, permission: "manageRewards" },
  { path: "/backups", title: "النسخ الاحتياطي", icon: CloudDownload, permission: "__adminOnly" },
  { path: "/approvals", title: "الموافقات الحساسة", icon: ClipboardCheck, permission: "__adminOnly" },
  { path: "/settings", title: "إعدادات متقدمة", icon: Settings2, permission: "__adminOnly" },
] as const;

function StatusChip({ live }: { live: boolean }) {
  return <span className={`status-chip ${live ? "live" : "offline"}`}><i className={live ? "pulse" : ""} />{live ? "مباشر" : "غير مباشر"}</span>;
}

function PanelHeading({ eyebrow, title, description, icon: Icon }: { eyebrow: string; title: string; description: string; icon: typeof Shield }) {
  return <div className="panel-heading"><div className="panel-heading-icon"><Icon size={20} /></div><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></div>;
}

function Dashboard({ user }: { user: SafeUser }) {
  const stream = trpc.stream.status.useQuery(undefined, { refetchInterval: 6_000, retry: false });
  const value = stream.data;
  return (
    <div className="section-stack">
      <div className="welcome-row"><div><div className="eyebrow">لوحة تحكم البث</div><h1>أهلًا، {user.name || "مشرف البث"}</h1><p>مركز إدارة الفريق والإشارات المباشرة لقناة REZK MODS.</p></div><span className="verified-tag"><ShieldCheck size={15} /> جلسة موثقة</span></div>
      <div className="dashboard-brand-banner"><img src="/branding/rezk-dashboard-banner.jpg" alt="REZK الشيخ" decoding="async" /></div>
      <section className="hero-status-card">
        <div className="hero-halo" />
        <div className="hero-status-copy"><span className="hero-kicker"><Radio size={15} /> LIVE SIGNAL</span><h2>{value?.isLive ? "البث على الهواء" : "الإشارة بانتظار البث"}</h2><p>{value?.connected ? "متصل ببوت Discord ويتابع تحديثات القناة." : "لم يتم ربط بوت Discord بعد أو أن الاتصال غير نشط."}</p><a className="inline-link" href="https://kick.com/es_hisham" target="_blank" rel="noreferrer noopener">الانتقال إلى قناة Kick <ExternalLink size={14} /></a></div>
        <div className="hero-status-metrics"><StatusChip live={value?.isLive ?? false} /><div className="viewer-number"><strong>{(value?.viewerCount ?? 0).toLocaleString("en-US")}</strong><span><Eye size={15} /> مشاهد الآن</span></div><div className="hero-badge">{value?.badge ?? "OFFLINE"}</div></div>
      </section>
      <div className="stats-row">
        <article className="stat-card"><div className="stat-icon cyan"><Activity size={18} /></div><span>حالة البوت</span><strong>{value?.connected ? "متصل" : "غير متصل"}</strong><small>{value?.updatedAt ? `آخر تحديث ${new Date(value.updatedAt).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}` : "بانتظار إعداد Discord"}</small></article>
        <article className="stat-card"><div className="stat-icon blue"><Users size={18} /></div><span>المشاهدون</span><strong>{(value?.viewerCount ?? 0).toLocaleString("en-US")}</strong><small>تُحدّث البيانات تلقائيًا من البوت</small></article>
        <article className="stat-card"><div className="stat-icon violet"><Crown size={18} /></div><span>رتبك الحالية</span><strong>{user.role === "admin" ? "مدير" : user.ranks.length.toLocaleString("ar")}</strong><small>{user.role === "admin" ? "صلاحيات الإدارة الكاملة" : user.ranks.map(rank => rank.name).join(" · ") || "لا توجد رتبة معينة"}</small></article>
      </div>
      <section className="content-card activity-card"><div className="card-heading"><div><span className="eyebrow">مركز الإشارات</span><h2>حالة اتصال البث</h2></div><StatusChip live={value?.isLive ?? false} /></div><div className="signal-row"><span className={`signal-led ${value?.connected ? "good" : ""}`} /><div><strong>{value?.connected ? "Discord متصل" : "Discord غير مربوط"}</strong><p>{value?.connected ? "يتحقق الخادم من رسائل الحالة في قناة البوت كل عدة ثوانٍ." : "اربط البوت من إعداد Discord لتفعيل تحديثات البادج والمشاهدين."}</p></div>{value?.connected && <span className="signal-meta">تحديث دوري</span>}</div></section>
    </div>
  );
}

type RankDraft = { id?: number; name: string; description: string; color: string; permissions: string[] };
const emptyDraft: RankDraft = { name: "", description: "", color: "#A9F4FF", permissions: [] };

function RanksPage({ isAdmin, myPermissions }: { isAdmin: boolean; myPermissions: SafeUser["permissions"] }) {
  const utils = trpc.useUtils();
  const ranks = trpc.ranks.list.useQuery();
  const members = trpc.ranks.members.useQuery();
  const [draft, setDraft] = useState<RankDraft>(emptyDraft);
  const [userId, setUserId] = useState("");
  const [rankId, setRankId] = useState("");
  const [notice, setNotice] = useState("");
  const save = trpc.ranks.save.useMutation({ onSuccess: async (result) => { setDraft(emptyDraft); setNotice(result.pendingApproval ? "تم إرسال تعديل الرتبة لموافقة مدير ثانٍ؛ لم تُطبّق الصلاحيات بعد." : "تم حفظ الرتبة وصلاحياتها."); await Promise.all([utils.ranks.list.invalidate(), utils.ranks.members.invalidate()]); } });
  const remove = trpc.ranks.delete.useMutation({ onSuccess: async () => { setNotice("تم حذف الرتبة وإزالة تعييناتها."); await Promise.all([utils.ranks.list.invalidate(), utils.ranks.members.invalidate()]); } });
  const assign = trpc.ranks.assign.useMutation({ onSuccess: async (result) => { setNotice(result.pendingApproval ? "تم إرسال تعيين الرتبة الحساسة لموافقة مدير ثانٍ." : "تم تعيين الرتبة للمستخدم."); await utils.ranks.members.invalidate(); } });
  const unassign = trpc.ranks.unassign.useMutation({ onSuccess: async (result) => { setNotice(result.pendingApproval ? "تم إرسال طلب إزالة الرتبة الحساسة لموافقة مدير ثانٍ." : "تمت إزالة الرتبة من المستخدم."); await utils.ranks.members.invalidate(); } });
  const rankRows = ranks.data ?? [];
  const memberRows = members.data ?? [];
  const selectedMember = memberRows.find(user => String(user.id) === userId);
  const canHandleRank = (rankPermissions: string[]) => isAdmin || rankPermissions.every(id => myPermissions.includes(id as SafeUser["permissions"][number]));

  function togglePermission(id: string) {
    setDraft(current => ({ ...current, permissions: current.permissions.includes(id) ? current.permissions.filter(value => value !== id) : [...current.permissions, id] }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    save.mutate({ ...draft, description: draft.description || null, permissions: draft.permissions as Array<typeof permissionChoices[number]["id"]> });
  }

  return (
    <div className="section-stack">
      <PanelHeading eyebrow="إدارة الوصول" title="الرتب والصلاحيات" description="أنشئ رتب الفريق وحدّد ما يمكن لكل رتبة إدارته، ثم عيّنها للحسابات المعتمدة." icon={Shield} />
      {notice && <div className="notice notice-cyan">{notice}</div>}
      {(save.error || remove.error || assign.error || unassign.error || ranks.error || members.error) && <div className="notice notice-red">{save.error?.message || remove.error?.message || assign.error?.message || unassign.error?.message || ranks.error?.message || members.error?.message}</div>}
      <div className="ranks-layout">
        <section className="content-card rank-editor"><div className="card-heading"><div><span className="eyebrow">محرر الرتبة</span><h2>{draft.id ? "تعديل الصلاحيات" : "إنشاء رتبة"}</h2></div><span className="editor-mark"><Settings2 size={17} /></span></div>
          <form className="stack-form" onSubmit={submit}>
            <label className="field-label">اسم الرتبة<input required minLength={2} maxLength={80} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="مثال: مشرف" /></label>
            <label className="field-label">الوصف<input maxLength={500} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} placeholder="نبذة مختصرة عن مسؤولية الرتبة" /></label>
            <label className="field-label">لون الشارة<div className="color-field"><input type="color" value={draft.color} onChange={event => setDraft(current => ({ ...current, color: event.target.value }))} /><code>{draft.color}</code></div></label>
            <div className="field-label">صلاحيات الرتبة<div className="permission-list">{permissionChoices.map(permission => <label className="permission-option" key={permission.id}><input type="checkbox" checked={draft.permissions.includes(permission.id)} disabled={!isAdmin && !myPermissions.includes(permission.id)} onChange={() => togglePermission(permission.id)} /><span className="check-ui"><Check size={12} /></span><span><b>{permission.label}</b><small>{permission.note}</small></span></label>)}</div></div>
            <div className="form-actions"><button className="primary-button" type="submit" disabled={save.isPending}><Save size={16} />{save.isPending ? "جارٍ الحفظ…" : draft.id ? "حفظ التغييرات" : "إنشاء الرتبة"}</button>{draft.id && <button className="secondary-button" type="button" onClick={() => setDraft(emptyDraft)}>إلغاء</button>}</div>
          </form>
        </section>
        <section className="content-card rank-list-card"><div className="card-heading"><div><span className="eyebrow">رتب الفريق</span><h2>الرتب المتاحة</h2></div><span className="count-badge">{rankRows.length.toLocaleString("ar")}</span></div>
          {rankRows.length === 0 ? <div className="empty-state"><ShieldCheck size={22} /><strong>لا توجد رتب بعد</strong><p>أنشئ أول رتبة وحدد صلاحياتها من المحرر.</p></div> : <div className="rank-list">{rankRows.map(rank => <article className="rank-row" key={rank.id}><span className="rank-color" style={{ backgroundColor: rank.color, boxShadow: `0 0 16px ${rank.color}55` }} /><div className="rank-copy"><strong>{rank.name}</strong><small>{rank.description || "دون وصف"}</small><div className="rank-permissions">{rank.permissions.length ? rank.permissions.map(id => <span key={id}>{permissionChoices.find(permission => permission.id === id)?.label ?? id}</span>) : <span className="muted-chip">بدون صلاحيات إدارية</span>}</div></div><div className="row-actions">{canHandleRank(rank.permissions) && <button className="icon-button" aria-label="تعديل" onClick={() => setDraft({ id: rank.id, name: rank.name, description: rank.description ?? "", color: rank.color, permissions: rank.permissions })}><Settings2 size={16} /></button>}{isAdmin && <button className="icon-button danger-icon" aria-label="حذف" onClick={() => { if (window.confirm(`حذف رتبة ${rank.name} وإزالة تعيينها من المستخدمين؟`)) remove.mutate({ id: rank.id }); }}><Trash2 size={16} /></button>}</div></article>)}</div>}
        </section>
      </div>
      <section className="content-card assignment-card"><div className="card-heading"><div><span className="eyebrow">إدارة الأعضاء</span><h2>تعيين الرتب للمستخدمين</h2><p>تظهر الحسابات المعتمدة فقط كهدف للتعيين.</p></div><Users size={21} className="subtle-icon" /></div>
        <div className="assignment-controls"><label className="field-label">المستخدم<select value={userId} onChange={event => setUserId(event.target.value)}><option value="">اختر مستخدمًا</option>{memberRows.filter(user => user.status === "approved").map(user => <option value={user.id} key={user.id}>{user.name || user.email || `#${user.id}`}</option>)}</select></label><label className="field-label">الرتبة<select value={rankId} onChange={event => setRankId(event.target.value)}><option value="">اختر رتبة</option>{rankRows.filter(rank => canHandleRank(rank.permissions)).map(rank => <option value={rank.id} key={rank.id}>{rank.name}</option>)}</select></label><button className="primary-button" disabled={!userId || !rankId || assign.isPending} onClick={() => assign.mutate({ userId: Number(userId), rankId: Number(rankId) })}><Plus size={16} /> تعيين الرتبة</button></div>
        {selectedMember && <div className="member-assigned"><div className="member-heading"><span>{selectedMember.name || selectedMember.email}</span><small>الرتب المسندة</small></div><div className="assigned-list">{selectedMember.ranks.length ? selectedMember.ranks.map(rank => <span className="assigned-chip" key={rank.id}>{rank.name}{canHandleRank(rankRows.find(r => r.id === rank.id)?.permissions ?? []) && <button aria-label={`إزالة ${rank.name}`} onClick={() => unassign.mutate({ userId: selectedMember.id, rankId: rank.id })}><X size={13} /></button>}</span>) : <span className="empty-inline">لم يتم تعيين رتب.</span>}</div></div>}
      </section>
      <div className="security-note"><LockKeyhole size={16} /><span>يتم التحقق من الصلاحيات في الخادم لكل طلب؛ إخفاء عناصر الواجهة ليس طبقة الحماية الوحيدة.</span></div>
    </div>
  );
}

function UsersPage({ isAdmin }: { isAdmin: boolean }) {
  const utils = trpc.useUtils();
  const users = trpc.users.list.useQuery();
  const approve = trpc.users.approve.useMutation({ onSuccess: async () => { await utils.users.list.invalidate(); } });
  const team = trpc.staff.team.useMutation({ onSuccess: async () => { await utils.users.list.invalidate(); } });
  const ban = trpc.users.ban.useMutation({ onSuccess: async () => { await utils.users.list.invalidate(); } });
  const rows = users.data ?? [];
  return (
    <div className="section-stack">
      <PanelHeading eyebrow="الوصول والحماية" title="إدارة المستخدمين" description="راجع طلبات الانضمام، وافق على الحسابات، أو امنع الحسابات من الوصول نهائيًا." icon={Users} />
      {(approve.error || ban.error || users.error || team.error) && <div className="notice notice-red">{approve.error?.message || ban.error?.message || users.error?.message || team.error?.message}</div>}
      <section className="content-card users-table-card"><div className="card-heading"><div><span className="eyebrow">قائمة الحسابات</span><h2>المستخدمون</h2></div><span className="count-badge">{rows.length.toLocaleString("ar")}</span></div>
        {rows.length === 0 ? <div className="empty-state"><UserRound size={24} /><strong>لا توجد حسابات للمراجعة</strong><p>سيظهر المستخدمون الجدد هنا بعد التسجيل.</p></div> : <div className="users-list">{rows.map(user => <article className="user-row" key={user.id}><div className="user-avatar">{(user.name || user.email || "U").slice(0, 1).toUpperCase()}</div><div className="user-main"><strong>{user.name || "مستخدم جديد"}</strong><small dir="ltr">{user.email || "—"}</small><div className="user-meta"><span className={`account-state ${user.status}`}>{user.status === "pending" ? "بانتظار الموافقة" : user.status === "banned" ? "محظور نهائيًا" : "معتمد"}</span><span>{user.loginMethod === "google" ? "Google" : "البريد الإلكتروني"}</span><span>{user.team === "main" ? "الفريق الأساسي" : "الفريق الاحتياطي"}</span><span>منذ {new Date(user.createdAt).toLocaleDateString("ar")}</span></div>{user.ranks.length > 0 && <div className="rank-permissions">{user.ranks.map(rank => <span key={rank.id}>{rank.name}</span>)}</div>}{user.status === "banned" && user.banReason && <small className="ban-reason">السبب: {user.banReason}</small>}</div><div className="user-actions">{isAdmin && user.status === "approved" && <button className="secondary-button" disabled={team.isPending} onClick={() => team.mutate({ userId: user.id, team: user.team === "main" ? "reserve" : "main" })}>{user.team === "main" ? "نقل للاحتياطي" : "نقل للأساسي"}</button>}{user.status === "pending" && <button className="primary-button compact" disabled={approve.isPending} onClick={() => approve.mutate({ userId: user.id })}><UserCheck size={15} /> موافقة</button>}{user.status !== "banned" && <button className="ban-button" onClick={() => { if (!window.confirm(`هل تريد حظر ${user.name || user.email} نهائيًا؟ سيتم قطع جلساته الحالية ومنعه من تسجيل الدخول لاحقًا.`)) return; const reason = window.prompt("سبب الحظر (اختياري):") ?? null; if (reason !== null) ban.mutate({ userId: user.id, reason: reason.trim() || null }); }}><Ban size={15} /> حظر دائم</button>}</div></article>)}</div>}
      </section>
      <div className="security-note"><Ban size={16} /><span>الحظر دائم بلا تاريخ انتهاء، ويُرفض تسجيل الدخول وتُلغى جلسات المستخدم الحالية فورًا. لا يمكن حظر حسابات المديرين من هذه الشاشة.</span></div>
    </div>
  );
}

function DiscordPage() {
  const utils = trpc.useUtils();
  const config = trpc.discord.config.useQuery(undefined, { refetchInterval: 12_000 });
  const stream = trpc.stream.status.useQuery(undefined, { refetchInterval: 8_000 });
  const [token, setToken] = useState("");
  const [channelId, setChannelId] = useState("");
  const [message, setMessage] = useState("");
  const save = trpc.discord.save.useMutation({ onSuccess: async () => { setToken(""); save.reset(); setMessage("تم التحقق من صلاحيات البوت وحفظ الإعدادات المشفرة."); await Promise.all([utils.discord.config.invalidate(), utils.stream.status.invalidate()]); } });
  const refresh = trpc.discord.refresh.useMutation({ onSuccess: async () => { await Promise.all([utils.discord.config.invalidate(), utils.stream.status.invalidate()]); } });

  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    save.mutate({ token, channelId });
  }

  return (
    <div className="section-stack">
      <PanelHeading eyebrow="تكامل البث" title="إعداد بوت Discord" description="اربط بوتًا يقرأ حالة البث من قناة محددة ويحدّث البادج وعدّاد المشاهدين." icon={Radio} />
      {(save.error || config.error) && <div className="notice notice-red">{save.error?.message || config.error?.message}</div>}
      {message && <div className="notice notice-cyan">{message}</div>}
      <div className="discord-layout">
        <section className="content-card discord-form-card"><div className="card-heading"><div><span className="eyebrow">بيانات الاتصال</span><h2>بيانات البوت والقناة</h2></div><KeyRound size={21} className="subtle-icon" /></div>
          <form className="stack-form" onSubmit={submit}>
            <label className="field-label">Discord bot token<div className="secret-field"><KeyRound size={16} /><input autoComplete="new-password" type="password" value={token} onChange={event => setToken(event.target.value)} required minLength={20} maxLength={512} placeholder={config.data?.configured ? "أدخل رمزًا جديدًا لتدويره" : "أدخل رمز البوت"} /></div><small className="helper-text">لا يتم إرجاع الرمز إلى المتصفح بعد الإرسال.</small></label>
            <label className="field-label">Channel ID<div className="input-wrap" dir="ltr"><Radio size={16} /><input inputMode="numeric" autoComplete="off" pattern="[0-9]{17,20}" minLength={17} maxLength={20} value={channelId} onChange={event => setChannelId(event.target.value)} required placeholder={config.data?.channelId || "123456789012345678"} /></div><small className="helper-text">يحتاج البوت صلاحية View Channel وRead Message History.</small></label>
            <button className="primary-button full-width" disabled={save.isPending}><KeyRound size={16} />{save.isPending ? "جارٍ اختبار الاتصال…" : "اختبار وحفظ الاتصال"}</button>
          </form>
          <div className="secure-storage-note"><LockKeyhole size={16} /><div><strong>تخزين محمي</strong><p>يُشفّر الخادم الرمز قبل تخزينه، باستخدام مفتاح تشفير محفوظ في أسرار بيئة الخادم. لا يُحفظ في التخزين المحلي أو حزمة الواجهة.</p></div></div>
        </section>
        <section className="content-card discord-status-card"><div className="card-heading"><div><span className="eyebrow">حالة التكامل</span><h2>اتصال البوت</h2></div><span className={`status-chip ${config.data?.connected ? "live" : "offline"}`}><i />{config.data?.connected ? "متصل" : "غير متصل"}</span></div>
          <div className="discord-status-visual"><div className={`discord-orb ${config.data?.connected ? "connected" : ""}`}><Radio size={27} /></div><div><strong>{config.data?.configured ? (config.data.connected ? "القناة تتم مراقبتها" : "تم حفظ الإعدادات") : "لم يتم الربط بعد"}</strong><p>{config.data?.configured ? `Channel ID: ${config.data.channelId}` : "احفظ بيانات البوت لتبدأ قراءة الرسائل."}</p></div></div>
          {config.data?.lastError && <div className="notice notice-amber">{config.data.lastError}</div>}
          <div className="live-preview-card"><div className="live-preview-top"><span>عرض الحالة</span><StatusChip live={stream.data?.isLive ?? false} /></div><div className="live-preview-number">{(stream.data?.viewerCount ?? 0).toLocaleString("en-US")}<small>مشاهد</small></div><div className="live-preview-badge">{stream.data?.badge ?? "OFFLINE"}</div></div>
          <button className="secondary-button full-width" disabled={!config.data?.configured || refresh.isPending} onClick={() => refresh.mutate()}><RefreshCw size={15} className={refresh.isPending ? "spin" : ""} /> تحديث حالة الاتصال</button>
        </section>
      </div>
      <section className="content-card format-card"><div className="card-heading"><div><span className="eyebrow">صيغة الرسالة</span><h2>ما الذي يقرأه البوت؟</h2></div><CircleHelp size={20} className="subtle-icon" /></div><p>ينشر البوت رسالة JSON في القناة، أو يحدّث رسالة الحالة نفسها. يتابع الخادم آخر رسالة كتبها بوت ويتعرف على `badge` و`viewerCount`، كما يفهم `isLive` عند توفره.</p><pre dir="ltr">{`{"badge":"LIVE","viewerCount":128}`}</pre><p>عند انتهاء البث، أرسل حالة صريحة حتى تُلغى كل الجلسات: <code>{`{"badge":"OFFLINE","viewerCount":0}`}</code> أو <code>{`{"isLive":false,"viewerCount":0}`}</code>. يتطلب قراءة محتوى الرسائل تفعيل Message Content Intent للبوت.</p>
      </section>
      <div className="security-note"><LockKeyhole size={16} /><span>يتصل الخادم مباشرة بواجهة Discord؛ لا يرسل رمز البوت إلى التطبيق الأمامي أو إلى Kick.</span></div>
    </div>
  );
}

function NoPermission() {
  return <section className="content-card denied-card"><div className="waiting-emblem"><LockKeyhole size={26} /></div><h2>هذه الصفحة تتطلب صلاحية</h2><p>اطلب من مدير البوابة تعيين رتبة تسمح لك بهذا الإجراء.</p></section>;
}

export default function Portal({ user, onLogout }: { user: SafeUser; onLogout: () => void }) {
  const [location, setLocation] = useLocation();
  const permissions = useMemo(() => new Set(user.permissions), [user.permissions]);
  const canPortal = (permission: string) => user.role === "admin" || permissions.has(permission as SafeUser["permissions"][number]);
  const notifications = trpc.notifications.list.useQuery(undefined, { refetchInterval: 30_000 });
  const visibleNav = navItems.filter(item => !("permission" in item) || !item.permission || user.role === "admin" || item.permission !== "__adminOnly" && permissions.has(item.permission as typeof permissionChoices[number]["id"]));
  let page = <Dashboard user={user} />;
  if (location === "/ranks") page = user.role === "admin" || permissions.has("manageRanks") ? <RanksPage isAdmin={user.role === "admin"} myPermissions={user.permissions} /> : <NoPermission />;
  else if (location === "/users") page = user.role === "admin" || permissions.has("manageUsers") ? <UsersPage isAdmin={user.role === "admin"} /> : <NoPermission />;
  else if (location === "/discord") page = user.role === "admin" || permissions.has("manageDiscord") ? <DiscordPage /> : <NoPermission />;
  else if (location === "/attendance") page = <AttendancePage user={user} />;
  else if (location === "/points") page = <PointsPage user={user} />;
  else if (location === "/absences") page = <AbsencesPage user={user} />;
  else if (location === "/discipline") page = <DisciplinePage user={user} />;
  else if (location === "/reports") page = user.role === "admin" || permissions.has("viewReports") ? <ReportsPage /> : <NoPermission />;
  else if (location === "/performance") page = <PerformancePage user={user} />;
  else if (location === "/voice") page = <VoiceRoomsPage user={user} />;
  else if (location === "/kick") page = user.role === "admin" || permissions.has("viewReports") ? <KickCenterPage isAdmin={user.role === "admin"} /> : <NoPermission />;
  else if (location === "/incidents") page = <IncidentsPage user={user} />;
  else if (location === "/academy") page = <AcademyPage user={user} />;
  else if (location === "/notifications") page = <NotificationsPage />;
  else if (location === "/security") page = <SecurityPage user={user} />;
  else if (location === "/audit") page = user.role === "admin" || permissions.has("viewAudit") ? <AuditPage /> : <NoPermission />;
  else if (location === "/moderation-center") page = canPortal("manageModeration") ? <ModerationPage user={user}/> : <NoPermission />;
  else if (location === "/automod") page = canPortal("manageAutoMod") ? <AutoModPage/> : <NoPermission />;
  else if (location === "/appeals") page = <AppealsPage user={user}/>;
  else if (location === "/analytics") page = canPortal("viewReports") ? <AnalyticsPage/> : <NoPermission />;
  else if (location === "/knowledge") page = <KnowledgePage user={user}/>;
  else if (location === "/announcements") page = <AnnouncementsPage user={user}/>;
  else if (location === "/chat") page = <StaffChatPage/>;
  else if (location === "/bookmarks") page = <BookmarksPage user={user}/>;
  else if (location === "/automations") page = canPortal("manageAutomations") ? <AutomationPage/> : <NoPermission />;
  else if (location === "/temp-voice") page = <TempVoicePage user={user}/>;
  else if (location === "/accounts") page = <AccountsPage/>;
  else if (location === "/rewards") page = canPortal("manageRewards") ? <RewardsPage/> : <NoPermission />;
  else if (location === "/backups") page = user.role === "admin" ? <BackupPage/> : <NoPermission />;
  else if (location === "/approvals") page = user.role === "admin" ? <ApprovalsPage/> : <NoPermission />;
  else if (location === "/settings") page = user.role === "admin" ? <AdminSettingsPage /> : <NoPermission />;
  else if (location !== "/" && location !== "/login" && location !== "/waiting-approval") page = <NoPermission />;

  return (
    <div className="portal-shell" dir="rtl">
      <SiteHeader email={user.email} onLogout={onLogout} />
      <div className="portal-layout">
        <aside className="portal-sidebar">
          <div className="sidebar-overline">MAIN MENU <span>01</span></div>
          <nav className="side-nav">{visibleNav.map(item => { const Icon = item.icon; const active = location === item.path; return <button key={item.path} className={`nav-link ${active ? "active" : ""}`} onClick={() => setLocation(item.path)}><Icon size={18} /><span>{item.title}{item.path === "/notifications" && Boolean(notifications.data?.unread) && ` (${notifications.data?.unread})`}</span>{active && <ArrowDownLeft size={14} className="nav-arrow" />}</button>; })}</nav>
          <div className="sidebar-spacer" />
          <div className="sidebar-account"><div className="account-avatar">{(user.name || user.email || "R").slice(0, 1).toUpperCase()}</div><div className="account-copy"><strong>{user.name || "عضو الفريق"}</strong><small dir="ltr">{user.email}</small></div><span className="account-dot" /></div>
          <div className="sidebar-footer"><span>REZK MODS</span><span>LIVE OPS · 2026</span></div>
        </aside>
        <main className="portal-content">{page}</main>
      </div>
    </div>
  );
}
