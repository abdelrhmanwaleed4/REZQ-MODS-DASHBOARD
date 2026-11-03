import { useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, AlertTriangle, Bell, BookOpen, Check, CircleHelp, Clock3, Download, KeyRound, LockKeyhole, Mic2, Plus, Radio, Shield, ShieldCheck, Trash2, Users, FileClock, Settings2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { SafeUser } from "../../../server/_core/appAuth";

const fmt = (date: Date | number | string | null | undefined) => date ? new Date(date).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }) : "—";
function Heading({ label, title, detail, icon: Icon }: { label: string; title: string; detail: string; icon: typeof Shield }) { return <div className="panel-heading"><div className="panel-heading-icon"><Icon size={21}/></div><div><span className="eyebrow">{label}</span><h1>{title}</h1><p>{detail}</p></div></div>; }
function ErrorBox({ value }: { value: unknown }) { return value instanceof Error ? <div role="alert" className="notice notice-red">{value.message}</div> : null; }
function Info({ value }: { value: string }) { return value ? <div className="notice notice-cyan">{value}</div> : null; }

export function VoiceRoomsPage({ user }: { user: SafeUser }) {
  const utils = trpc.useUtils();
  const config = trpc.voice.config.useQuery();
  const list = trpc.voice.list.useQuery(undefined, { refetchInterval: 30_000 });
  const [guildId, setGuildId] = useState("");
  const options = trpc.voice.options.useQuery({ guildId: guildId || undefined }, { enabled: user.role === "admin" || user.permissions.includes("manageDiscord") });
  const [categoryId, setCategoryId] = useState("");
  const [alertsChannelId, setAlertsChannelId] = useState("");
  const [adoptChannelId, setAdoptChannelId] = useState("");
  const [name, setName] = useState("");
  const [userLimit, setUserLimit] = useState(0);
  const [message, setMessage] = useState("");
  const saveConfig = trpc.voice.configure.useMutation({ onSuccess: async () => { setMessage("تم إعداد الرومات الصوتية."); await utils.voice.invalidate(); } });
  const adopt = trpc.voice.adopt.useMutation({ onSuccess: async () => { setAdoptChannelId(""); setMessage("تم ضم الروم الموجود للإدارة. الرتب المخولة تقدر تديره أو تحذفه الآن."); await utils.voice.list.invalidate(); } });
  const create = trpc.voice.create.useMutation({ onSuccess: async () => { setName(""); setMessage("تم إنشاء الروم داخل Discord."); await utils.voice.list.invalidate(); } });
  const remove = trpc.voice.delete.useMutation({ onSuccess: async (result) => { setMessage(result.approvalRequired ? "الروم الأصلي لم يُحذف بعد: بانتظار موافقة مدير ثانٍ من صفحة الموافقات الحساسة." : "تم حذف الروم من Discord."); await utils.voice.list.invalidate(); } });
  const update = trpc.voice.update.useMutation({ onSuccess: async () => { setMessage("تم تعديل الروم."); await utils.voice.list.invalidate(); } });
  const lock = trpc.voice.lock.useMutation({ onSuccess: async () => { setMessage("تم تغيير حالة قفل الروم."); await utils.voice.list.invalidate(); } });
  const rooms = list.data?.rooms || [];
  const selectedGuild = guildId || config.data?.guildId || "";
  return <div className="section-stack">
    <Heading label="VOICE CONTROL" title="إدارة الرومات الصوتية" detail="إنشاء وتعديل وحذف الرومات من Discord مباشرة. الحذف مسموح فقط للرومات اللي الموقع أنشأها أو ضمّها المدير صراحة للإدارة، وبحسب صلاحيات الرتبة." icon={Mic2}/>
    <Info value={message}/><ErrorBox value={saveConfig.error || adopt.error || create.error || remove.error || update.error || lock.error || list.error || options.error}/>
    {user.role === "admin" && <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">BOT CONFIGURATION</span><h2>إعداد السيرفر والكاتجوري</h2></div><Settings2 size={20}/></div>
      <form className="ops-form" onSubmit={e => { e.preventDefault(); saveConfig.mutate({ guildId: selectedGuild, categoryId: categoryId || config.data?.categoryId || "", alertsChannelId }); }}>
        <label className="field-label">السيرفر<select required value={selectedGuild} onChange={e => { setGuildId(e.target.value); setCategoryId(""); }}><option value="">اختر السيرفر</option>{options.data?.guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <label className="field-label">الكاتجوري الصوتي<select required value={categoryId || (selectedGuild === config.data?.guildId ? config.data?.categoryId || "" : "")} onChange={e => setCategoryId(e.target.value)}><option value="">اختر كاتجوري</option>{options.data?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field-label">قناة تنبيهات Discord (اختياري)<select value={alertsChannelId} onChange={e => setAlertsChannelId(e.target.value)}><option value="">بدون تنبيهات</option>{options.data?.textChannels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="primary-button" disabled={saveConfig.isPending || !selectedGuild}><Check size={16}/> حفظ الإعدادات</button>
      </form><p className="ops-muted">البوت محتاج Manage Channels لإنشاء وحذف الرومات، وManage Roles لقفلها.</p>
      {config.data?.enabled && <form className="ops-form" onSubmit={e => { e.preventDefault(); if (!adoptChannelId || !window.confirm("هتضم الروم ده لإدارة الموقع. أي رتبة معاها Delete Voice Rooms هتقدر تحذفه نهائيًا. متأكد؟")) return; adopt.mutate({ channelId: adoptChannelId }); }}>
        <label className="field-label">ضم روم فويس موجود بالفعل لإدارة الموقع
          <select value={adoptChannelId} onChange={e => setAdoptChannelId(e.target.value)} required><option value="">اختر روم من الكاتجوري المحدد</option>
            {options.data?.voiceChannels.filter(c => c.parentId === config.data?.categoryId && !rooms.some(r => r.channelId === c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button className="secondary-button" disabled={adopt.isPending || !adoptChannelId}>ضم الروم لإدارة الموقع</button>
      </form>}
      </section>}
    {list.data?.canCreate && <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">CREATE VOICE</span><h2>روم صوتي جديد</h2></div><Plus size={18}/></div><form className="ops-form" onSubmit={e => { e.preventDefault(); create.mutate({ name, userLimit }); }}>
      <label className="field-label">اسم الروم<input minLength={2} maxLength={80} required value={name} onChange={e => setName(e.target.value)} placeholder="🎙️┃Lounge"/></label>
      <label className="field-label">الحد الأقصى للأعضاء (0 بدون حد)<input type="number" min={0} max={99} value={userLimit} onChange={e => setUserLimit(Number(e.target.value))}/></label>
      <button className="primary-button" disabled={!config.data?.enabled || create.isPending}><Plus size={17}/> إنشاء في Discord</button>
    </form></section>}
    <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">MANAGED CHANNELS</span><h2>الرومات المدارة</h2></div><span className="count-badge">{rooms.length}</span></div>
      {rooms.length ? <div className="ops-rows">{rooms.map(r => <article key={r.id} className="ops-entry"><div className="ops-entry-main"><b>{r.name}</b><p>{r.source === "adopted" ? "روم موجود ضمّته الإدارة" : "روم أنشأه الموقع"} · السعة: {r.userLimit || "مفتوح"} · {r.locked ? "مقفول" : "مفتوح"}</p><small dir="ltr">{r.channelId}</small></div><div className="ops-entry-actions">
        {list.data?.canManage && <><button className="secondary-button" disabled={update.isPending} onClick={() => { const name = window.prompt("اسم الروم الجديد", r.name); if (!name) return; const limit = window.prompt("أقصى عدد أعضاء (0-99)", String(r.userLimit)); if (limit === null) return; update.mutate({ id: r.id, name, userLimit: Number(limit) }); }}>تعديل</button><button className="secondary-button" disabled={lock.isPending} onClick={() => lock.mutate({ id: r.id, locked: !r.locked })}>{r.locked ? "فتح" : "قفل"}</button></>}
        {list.data?.canDelete && <button className="ban-button" disabled={remove.isPending} onClick={() => { if (window.confirm(`حذف روم ${r.name} من ديسكورد نهائيًا؟ أي أعضاء داخله سيتم فصلهم.`)) remove.mutate({ id: r.id }); }}><Trash2 size={15}/> حذف</button>}
      </div></article>)}</div> : <p className="ops-muted">مفيش رومات أنشأها الموقع أو ضمّتها الإدارة حاليًا.</p>}</section>
    <div className="security-note"><LockKeyhole size={16}/><span>صلاحيات Create Voice Rooms وDelete Voice Rooms وManage Voice Rooms مستقلة، وتقدر تعين كل واحدة لأي رتبة من صفحة الرتب.</span></div>
  </div>;
}

export function NotificationsPage() {
  const utils = trpc.useUtils();
  const notifications = trpc.notifications.list.useQuery(undefined, { refetchInterval: 20_000 });
  const read = trpc.notifications.read.useMutation({ onSuccess: () => utils.notifications.list.invalidate() });
  const all = trpc.notifications.readAll.useMutation({ onSuccess: () => utils.notifications.list.invalidate() });
  const [desktopAlerts, setDesktopAlerts] = useState<NotificationPermission | "unsupported">(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const knownIds = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!notifications.data) return;
    const newest = notifications.data.rows.filter(row => !row.readAt);
    if (knownIds.current && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState === "hidden") {
      for (const item of newest.filter(item => !knownIds.current!.has(item.id)).slice(0, 3)) {
        try { new Notification(item.title, { body: item.message.slice(0, 160), icon: "/branding/rezk-logo.png" }); } catch { /* Some browsers only permit SW notifications. */ }
      }
    }
    knownIds.current = new Set(notifications.data.rows.map(row => row.id));
  }, [notifications.data]);
  return <div className="section-stack"><Heading label="INBOX" title="الإشعارات" detail="تنبيهات حسابك ومخالفاتك وبلاغاتك وترقياتك وبداية البث." icon={Bell}/><ErrorBox value={notifications.error}/><section className="content-card ops-card"><div className="ops-actions"><button className="secondary-button" disabled={desktopAlerts === "unsupported" || desktopAlerts === "denied" || desktopAlerts === "granted"} onClick={async () => { if (typeof Notification !== "undefined") setDesktopAlerts(await Notification.requestPermission()); }}>{desktopAlerts === "granted" ? "إشعارات المتصفح مفعّلة" : desktopAlerts === "denied" ? "إشعارات المتصفح محظورة" : desktopAlerts === "unsupported" ? "المتصفح لا يدعم الإشعارات" : "تفعيل إشعارات المتصفح"}</button><small>تظهر التنبيهات أثناء فتح الموقع فقط. الإشعارات أثناء الإغلاق تتطلب خادم Push منفصل.</small></div></section><section className="content-card ops-card"><div className="card-heading"><h2>غير المقروءة: {notifications.data?.unread || 0}</h2><button className="secondary-button" disabled={all.isPending} onClick={() => all.mutate()}>قراءة الكل</button></div><div className="ops-rows">{notifications.data?.rows.map(n => <article className="ops-entry" key={n.id}><div className="ops-entry-main"><b>{n.title}</b><p>{n.message}</p><small>{fmt(n.createdAt)}</small></div>{!n.readAt && <button className="secondary-button" disabled={read.isPending} onClick={() => read.mutate({ id: n.id })}>تمت القراءة</button>}</article>)}{!notifications.data?.rows.length && <p className="ops-muted">مافيش إشعارات.</p>}</div></section></div>;
}

export function IncidentsPage({ user }: { user: SafeUser }) {
  const utils = trpc.useUtils();
  const manager = user.role === "admin" || user.permissions.includes("manageReports");
  const list = trpc.incidents.list.useQuery();
  const [category, setCategory] = useState<"conduct"|"technical"|"appeal"|"other">("conduct");
  const [description, setDescription] = useState(""); const [evidenceUrl, setEvidenceUrl] = useState(""); const [message, setMessage] = useState("");
  const submit = trpc.incidents.submit.useMutation({ onSuccess: async () => { setDescription(""); setEvidenceUrl(""); setMessage("تم رفع البلاغ بسرية."); await utils.incidents.list.invalidate(); } });
  const review = trpc.incidents.review.useMutation({ onSuccess: async () => { setMessage("تم تحديث البلاغ وإبلاغ صاحبه."); await utils.incidents.list.invalidate(); } });
  return <div className="section-stack"><Heading label="REPORT CENTER" title="البلاغات الداخلية" detail="قدّم بلاغًا بإثبات، وتابع نتيجته. البلاغات لا تظهر لغير صاحبها والمسؤولين المخولين." icon={AlertTriangle}/><Info value={message}/><ErrorBox value={submit.error || review.error || list.error}/>
    <section className="content-card ops-card"><div className="card-heading"><h2>تقديم بلاغ</h2></div><form className="ops-form" onSubmit={e => { e.preventDefault(); submit.mutate({ category, description, evidenceUrl }); }}>
      <label className="field-label">النوع<select value={category} onChange={e => setCategory(e.target.value as typeof category)}><option value="conduct">سلوك عضو</option><option value="technical">مشكلة تقنية</option><option value="appeal">تظلم</option><option value="other">أخرى</option></select></label>
      <label className="field-label">رابط الإثبات (HTTPS اختياري)<input type="url" value={evidenceUrl} onChange={e => setEvidenceUrl(e.target.value)}/></label>
      <label className="field-label ops-wide">تفاصيل البلاغ<textarea required minLength={15} maxLength={2000} rows={4} value={description} onChange={e => setDescription(e.target.value)}/></label>
      <button className="primary-button" disabled={submit.isPending}><Plus size={16}/> إرسال البلاغ</button>
    </form></section>
    <section className="content-card ops-card"><div className="card-heading"><h2>{manager ? "بلاغات الفريق" : "بلاغاتي"}</h2></div><div className="ops-rows">{list.data?.map(r => <article key={r.id} className="ops-entry"><div className="ops-entry-main"><b>بلاغ #{r.id} · {r.category} · {r.status}</b><p>{r.description}</p><small>{fmt(r.createdAt)}</small>{r.evidenceUrl && <a href={r.evidenceUrl} target="_blank" rel="noreferrer">الإثبات</a>}{r.response && <p>رد الإدارة: {r.response}</p>}</div>{manager && !["resolved","rejected"].includes(r.status) && r.reporterId !== user.id && <div className="ops-entry-actions"><button className="secondary-button" onClick={() => review.mutate({ id: r.id, status: "reviewing", response: "" })}>قيد المراجعة</button><button className="primary-button" onClick={() => review.mutate({ id: r.id, status: "resolved", response: window.prompt("قرار الإدارة") || "" })}>حل</button><button className="ban-button" onClick={() => review.mutate({ id: r.id, status: "rejected", response: window.prompt("سبب الرفض") || "" })}>رفض</button></div>}</article>)}{!list.data?.length && <p className="ops-muted">لا توجد بلاغات.</p>}</div></section>
  </div>;
}

export function AcademyPage({ user }: { user: SafeUser }) {
  const utils = trpc.useUtils();
  const manager = user.role === "admin" || user.permissions.includes("manageAcademy");
  const exam = trpc.academy.exam.useQuery();
  const history = trpc.academy.attempts.useQuery();
  const bank = trpc.academy.questionBank.useQuery(undefined, { enabled: manager });
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [question, setQuestion] = useState(""); const [options, setOptions] = useState(["", "", "", ""]); const [correctIndex, setCorrectIndex] = useState(0); const [message, setMessage] = useState("");
  const add = trpc.academy.addQuestion.useMutation({ onSuccess: async () => { setMessage("تمت إضافة السؤال."); setQuestion(""); setOptions(["", "", "", ""]); await Promise.all([utils.academy.questionBank.invalidate(), utils.academy.exam.invalidate()]); } });
  const toggle = trpc.academy.toggle.useMutation({ onSuccess: async () => { await Promise.all([utils.academy.questionBank.invalidate(), utils.academy.exam.invalidate()]); } });
  const take = trpc.academy.take.useMutation({ onSuccess: async r => { setMessage(`النتيجة: ${r.percent}%، ${r.passed ? "اجتياز ✅" : "لم تجتز"}.`); setAnswers({}); await utils.academy.attempts.invalidate(); } });
  return <div className="section-stack"><Heading label="ACADEMY" title="أكاديمية المودات" detail="امتحان تصحيحه تلقائي، إجاباته محفوظة في الخادم ولا تمنح رتبًا تلقائيًا." icon={BookOpen}/><Info value={message}/><ErrorBox value={add.error || take.error || toggle.error || exam.error}/>
    {manager && <section className="content-card ops-card"><div className="card-heading"><h2>بنك الأسئلة</h2></div><form className="ops-form" onSubmit={e => { e.preventDefault(); add.mutate({ question, options, correctIndex }); }}><label className="field-label ops-wide">السؤال<input required minLength={12} maxLength={500} value={question} onChange={e => setQuestion(e.target.value)}/></label>{options.map((o, i) => <label key={i} className="field-label">الاختيار {i + 1}<input required value={o} onChange={e => setOptions(prev => prev.map((v, j) => i === j ? e.target.value : v))}/></label>)}<label className="field-label">الإجابة الصحيحة<select value={correctIndex} onChange={e => setCorrectIndex(Number(e.target.value))}>{[0,1,2,3].map(i => <option value={i} key={i}>اختيار {i + 1}</option>)}</select></label><button className="primary-button" disabled={add.isPending}>إضافة السؤال</button></form><div className="ops-rows">{bank.data?.map(q => <article className="ops-entry" key={q.id}><b>{q.question}</b><button className="secondary-button" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: q.id, enabled: !q.enabled })}>{q.enabled ? "تعطيل" : "تفعيل"}</button></article>)}</div></section>}
    <section className="content-card ops-card"><div className="card-heading"><h2>اختبار المود</h2><span className="count-badge">{exam.data?.length || 0} سؤال</span></div>{(exam.data?.length || 0) >= 3 ? <form className="stack-form" onSubmit={e => { e.preventDefault(); take.mutate({ answers: exam.data!.map(q => ({ id: q.id, answer: answers[q.id] })) }); }}>{exam.data!.map((q, ix) => <div className="ops-entry" key={q.id}><b>{ix+1}. {q.question}</b><div className="permission-list">{q.options.map((answer, a) => <label key={a} className="permission-option"><input type="radio" name={`q${q.id}`} required checked={answers[q.id] === a} onChange={() => setAnswers(v => ({ ...v, [q.id]: a }))}/>{answer}</label>)}</div></div>)}<button className="primary-button" disabled={take.isPending || Object.keys(answers).length !== exam.data!.length}>تسليم الإجابات</button></form> : <p className="ops-muted">لا يمكن بدء الامتحان قبل وجود 3 أسئلة فعالة على الأقل.</p>}</section>
    <section className="content-card ops-card"><div className="card-heading"><h2>نتائج الاختبارات</h2></div><div className="ops-rows">{history.data?.map(a => <article className="ops-entry" key={a.id}><b>{a.score} / {a.total} · {a.passed ? "ناجح" : "لم يجتز"}</b><small>{fmt(a.createdAt)}</small></article>)}</div></section>
  </div>;
}

export function PerformancePage({ user }: { user: SafeUser }) {
  const [period, setPeriod] = useState<"week"|"month">("week"); const [offset, setOffset] = useState(0);
  const [profileId, setProfileId] = useState("");
  const rows = trpc.performance.leaderboard.useQuery({ period, offset });
  const canViewOthers = user.role === "admin" || user.permissions.includes("viewReports") || user.permissions.includes("manageUsers");
  const profile = trpc.performance.profile.useQuery({ userId: canViewOthers && profileId ? Number(profileId) : undefined });
  return <div className="section-stack"><Heading label="PERFORMANCE" title="التقييم والترتيب" detail="تقييم من 100 مبني على حضور الموقع المتفاعل (40) والنقاط (35) والسلوك الإداري (25)." icon={Activity}/><ErrorBox value={rows.error || profile.error}/>
    <section className="content-card ops-card"><div className="card-heading"><h2>{profileId ? "ملف المود" : "ملفي الإداري"}</h2>{canViewOthers && <select value={profileId} onChange={e => setProfileId(e.target.value)}><option value="">ملفي</option>{rows.data?.rows.map(m => <option key={m.id} value={m.id}>{m.name || `#${m.id}`}</option>)}</select>}</div><div className="ops-stats"><div className="ops-stat"><small>رصيد النقاط</small><strong>{profile.data?.pointTotal ?? "…"}</strong></div><div className="ops-stat"><small>دقائق التفاعل بالموقع</small><strong>{profile.data?.verifiedMinutes ?? "…"}</strong></div><div className="ops-stat"><small>إنذارات نشطة</small><strong>{profile.data?.warnings ?? "…"}</strong></div><div className="ops-stat"><small>تقييمي للفترة</small><strong>{rows.data?.own?.score.total ?? 0} / 100</strong></div></div></section>
    <section className="content-card ops-card"><div className="card-heading"><h2>Leaderboard · {rows.data?.label}</h2><div className="ops-actions"><select value={period} onChange={e => { setPeriod(e.target.value as typeof period); setOffset(0); }}><option value="week">أسبوعي</option><option value="month">شهري</option></select><button className="secondary-button" disabled={offset >= 12} onClick={() => setOffset(v => v + 1)}>السابق</button><button className="secondary-button" disabled={offset === 0} onClick={() => setOffset(v => v - 1)}>التالي</button></div></div><p className="ops-muted">{rows.data?.scoring}</p><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>#</th><th>المود</th><th>التقييم</th><th>دقائق</th><th>النقاط</th></tr></thead><tbody>{rows.data?.rows.map((r, i) => <tr key={r.id}><td>{i + 1}</td><td><b>{r.name || `#${r.id}`}</b>{r.id === user.id ? " (أنت)" : ""}</td><td><b>{r.score.total}/100</b></td><td>{r.verifiedMinutes}</td><td>{r.points}</td></tr>)}</tbody></table></div></section>
  </div>;
}

export function AuditPage() { const logs = trpc.audits.list.useQuery(); return <div className="section-stack"><Heading label="AUDIT" title="سجل التعديلات" detail="كل تغيير مهم يُوثَّق بالفاعل والوقت والمعرّف، بدون أسرار أو توكنات." icon={FileClock}/><ErrorBox value={logs.error}/><section className="content-card ops-card"><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>الوقت</th><th>الفاعل</th><th>الإجراء</th><th>الهدف</th><th>التفاصيل</th></tr></thead><tbody>{logs.data?.map(e => <tr key={e.id}><td>{fmt(e.createdAt)}</td><td>{e.actorId || "النظام"}</td><td dir="ltr">{e.action}</td><td>{e.targetType} #{e.targetId}</td><td>{e.details}</td></tr>)}</tbody></table></div></section></div>; }

export function AdminSettingsPage() {
  const utils = trpc.useUtils(); const settings = trpc.settings.admin.useQuery();
  const [values, setValues] = useState({ pointsPerActivity: 15, elitePoints: 150, subLeaderPoints: 400, leadershipPoints: 800, attendanceTargetMinutes: 180, examPassingPercent: 70, kickChannelSlug: "es_hisham" }); const [message, setMessage] = useState("");
  useEffect(() => { if (settings.data) setValues({ pointsPerActivity: settings.data.pointsPerActivity, elitePoints: settings.data.elitePoints, subLeaderPoints: settings.data.subLeaderPoints, leadershipPoints: settings.data.leadershipPoints, attendanceTargetMinutes: settings.data.attendanceTargetMinutes, examPassingPercent: settings.data.examPassingPercent, kickChannelSlug: settings.data.kickChannelSlug }); }, [settings.data]);
  const save = trpc.settings.save.useMutation({ onSuccess: async () => { setMessage("تم حفظ إعدادات الإدارة."); await utils.settings.invalidate(); } });
  const fields = [{ id: "pointsPerActivity", label: "نقاط النشاط الافتراضية" }, { id: "elitePoints", label: "حد Elite Staff" }, { id: "subLeaderPoints", label: "حد Sub-Leader" }, { id: "leadershipPoints", label: "حد القيادة العليا" }, { id: "attendanceTargetMinutes", label: "هدف الحضور بالدقائق للتقييم" }, { id: "examPassingPercent", label: "نسبة اجتياز الامتحان %" }] as const;
  return <div className="section-stack"><Heading label="CONTROL PANEL" title="إعدادات متقدمة" detail="تخصيص النقاط والحدود والتقييم والقناة اللي بيتم التحقق من أحداث Kick الخاصة بيها." icon={Settings2}/><Info value={message}/><ErrorBox value={save.error || settings.error}/><section className="content-card ops-card"><form className="ops-form" onSubmit={e => { e.preventDefault(); save.mutate(values); }}>{fields.map(f => <label key={f.id} className="field-label">{f.label}<input type="number" required min={1} max={100000} value={values[f.id]} onChange={e => setValues(v => ({ ...v, [f.id]: Number(e.target.value) }))}/></label>)}<label className="field-label">Kick Channel Slug<input required pattern="[a-zA-Z0-9_-]{2,80}" value={values.kickChannelSlug} onChange={e => setValues(v => ({ ...v, kickChannelSlug: e.target.value }))}/></label><button className="primary-button" disabled={save.isPending}>حفظ</button></form></section></div>;
}

export function SecurityPage({ user }: { user: SafeUser }) {
  const sessions = trpc.sessions.list.useQuery(); const utils = trpc.useUtils(); const revoke = trpc.sessions.revoke.useMutation({ onSuccess: () => utils.sessions.list.invalidate() });
  const [secret, setSecret] = useState(""); const [code, setCode] = useState(""); const [message, setMessage] = useState("");
  const begin = trpc.mfa.begin.useMutation({ onSuccess: result => { setSecret(result.secret); setMessage("أضف المفتاح لتطبيق Authenticator ثم أدخل الرمز للتفعيل."); } });
  const enable = trpc.mfa.enable.useMutation({ onSuccess: () => window.location.reload() });
  return <div className="section-stack"><Heading label="ACCOUNT SECURITY" title="أمان الحساب والجلسات" detail="عرض الأجهزة المتصلة، إنهاء الجلسات الأخرى، وإضافة تحقق ثنائي للحساب الإداري." icon={ShieldCheck}/><Info value={message}/><ErrorBox value={revoke.error || begin.error || enable.error || sessions.error}/>
    {user.role === "admin" && <section className="content-card ops-card"><div className="card-heading"><h2>Authenticator 2FA</h2></div><p>{user.mfaEnabled ? "التحقق الإضافي مفعّل ✅" : "احمِ عمليات الإدارة بتطبيق رموز التحقق."}</p>{!user.mfaEnabled && <><button className="secondary-button" disabled={begin.isPending} onClick={() => begin.mutate()}><KeyRound size={16}/> توليد مفتاح التحقق</button>{secret && <form className="stack-form" onSubmit={e => { e.preventDefault(); enable.mutate({ code }); }}><p className="ops-muted">انسخ المفتاح إلى Google Authenticator أو أي تطبيق TOTP. لا ترسل المفتاح في الشات.</p><div className="input-wrap" dir="ltr"><input readOnly value={secret}/></div><label className="field-label">رمز 6 أرقام<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)}/></label><button className="primary-button" disabled={enable.isPending}>تفعيل الحماية</button></form>}</>}</section>}
    <section className="content-card ops-card"><div className="card-heading"><h2>جلسات تسجيل الدخول</h2></div><div className="ops-rows">{sessions.data?.map(s => <article className="ops-entry" key={s.id}><div className="ops-entry-main"><b>{s.id === user.sessionId ? "الجلسة الحالية" : "جلسة أخرى"} {s.revokedAt ? "(منتهية)" : ""}</b><p>{s.userAgent || "جهاز غير معروف"}</p><small>{fmt(s.createdAt)}</small></div>{!s.revokedAt && s.id !== user.sessionId && <button className="ban-button" disabled={revoke.isPending} onClick={() => revoke.mutate({ id: s.id })}>إنهاء الجلسة</button>}</article>)}</div></section>
  </div>;
}

export function KickCenterPage({ isAdmin = false }: { isAdmin?: boolean }) {
  const members = trpc.staff.members.useQuery();
  const presence = trpc.attendance.history.useQuery(undefined, { refetchInterval: 30_000 });
  const integration = trpc.kick.integration.useQuery(undefined, { enabled: isAdmin });
  const subscribe = trpc.kick.subscribe.useMutation();
  const refresh = trpc.kick.refresh.useMutation();
  const status = trpc.stream.status.useQuery(undefined, { refetchInterval: 8_000 }); const events = trpc.kick.events.useQuery(undefined, { refetchInterval: 15_000 }); const settings = trpc.settings.get.useQuery();
  return <div className="section-stack"><Heading label="LIVE OPS" title="مركز متابعة Kick" detail="أحداث Kick الموقعة رسميًا، حالة اللايف، والمراقبة التشغيلية. الربط يحتاج إعداد Webhook رسمي، ولا يتتبع إجراءات جميع المودات تلقائيًا." icon={Radio}/><ErrorBox value={events.error || status.error}/>
    <div className="ops-stats"><div className="ops-stat"><small>البث</small><strong>{status.data?.isLive ? "LIVE 🔴" : "OFFLINE"}</strong></div><div className="ops-stat"><small>المشاهدون</small><strong>{status.data?.viewerCount ?? 0}</strong></div><div className="ops-stat"><small>آخر تحديث</small><strong>{fmt(status.data?.updatedAt)}</strong></div></div>
    <section className="content-card ops-card"><div className="card-heading"><h2>تواجد الفريق بالموقع</h2></div><p>المودات اللي سجلت حضور ومفتوحة جلستها في الموقع (مش إثبات تواجد في شات Kick):</p><div className="ops-rows">{presence.data?.rows.filter(s => !s.endedAt).map(s => <article className="ops-entry" key={s.id}><b>{members.data?.find(m => m.id === s.userId)?.name || `#${s.userId}`}</b><small>منذ {fmt(s.startedAt)}</small></article>)}{!presence.data?.rows.some(s => !s.endedAt) && <p className="ops-muted">مفيش مودات مسجلين حضور حاليًا.</p>}</div></section><section className="content-card ops-card"><div className="card-heading"><h2>Kick Webhook</h2></div><p>القناة: <b>{settings.data?.kickChannelSlug}</b></p><p className="ops-muted">رابط استقبال الأحداث: <code>/api/kick/webhook</code>. فعِّل Events API من لوحة مطوري Kick، وسجل اشتراكات الأحداث الرسمية. ضبط <code>KICK_WEBHOOK_PRIORITY=1</code> يوقف Discord من استبدال حالة بث Kick. عدّاد المشاهدين يمكن تحديثه من Kick API بمفاتيح الخادم.</p>{isAdmin && <><p>مفاتيح Kick: <b>{integration.data?.configured ? "مهيأة" : "غير مهيأة"}</b> · أولوية أحداث Kick: <b>{integration.data?.kickPriorityEnabled ? "مفعلة" : "غير مفعلة"}</b></p><div className="ops-actions"><button className="primary-button" disabled={!integration.data?.configured || subscribe.isPending} onClick={() => { if (window.confirm("هل تم ضبط رابط Webhook في Kick Developer؟")) subscribe.mutate(); }}>تسجيل اشتراكات Kick</button><button className="secondary-button" disabled={!integration.data?.configured || refresh.isPending} onClick={() => refresh.mutate()}>تحديث المشاهدين</button></div><ErrorBox value={subscribe.error || refresh.error}/>{subscribe.isSuccess && <p className="notice notice-cyan">أُرسل طلب الاشتراك إلى Kick. راجع إعدادات التطبيق.</p>}</>}</section>
    <section className="content-card ops-card"><div className="card-heading"><h2>الأحداث الأخيرة</h2></div><div className="ops-rows">{events.data?.map(e => <article key={e.messageId} className="ops-entry"><div className="ops-entry-main"><b>{e.summary}</b><p>{e.type}</p><small>{fmt(e.createdAt)}</small></div></article>)}{!events.data?.length && <p className="ops-muted">لم يتم استقبال أحداث موقّعة بعد.</p>}</div></section>
  </div>;
}

export function MfaChallenge() {
  const [code, setCode] = useState(""); const verify = trpc.mfa.verify.useMutation({ onSuccess: () => window.location.assign("/") });
  return <main className="loading-screen" dir="rtl"><div className="loading-mark"><span/></div><h2>التحقق بخطوتين</h2><p>ادخل الكود من تطبيق Authenticator لاستكمال دخول الإدارة.</p><form className="stack-form" onSubmit={e => { e.preventDefault(); verify.mutate({ code }); }}><input autoFocus required pattern="[0-9]{6}" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value)}/><button className="primary-button" disabled={verify.isPending}>تحقق وادخل</button></form><ErrorBox value={verify.error}/></main>;
}
