import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, AlertTriangle, CalendarDays, CheckCircle2, Clock3, FileDown, MinusCircle, Plus, ShieldAlert, Star, TimerReset, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { SafeUser } from "../../../server/_core/appAuth";

type User = Pick<SafeUser, "id" | "role" | "permissions" | "name">;
const isManager = (user: User, permission: string) => user.role === "admin" || user.permissions.includes(permission as SafeUser["permissions"][number]);
const fmt = (value: string | number | Date | null | undefined) => value ? new Date(value).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }) : "—";
const hours = (seconds: number) => `${(seconds / 3600).toFixed(2)} ساعة`;
const memberName = (people: Array<{ id: number; name: string | null }> | undefined, id: number, self: User) => people?.find(m => m.id === id)?.name || (id === self.id ? self.name || "حسابي" : `#${id}`);
const defaultDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qatar", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function Header({ eyebrow, title, detail, icon: Icon }: { eyebrow: string; title: string; detail: string; icon: typeof Activity }) {
  return <div className="panel-heading"><div className="panel-heading-icon"><Icon size={21}/></div><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div></div>;
}
function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : null;
  return message && <div role="alert" className="notice notice-red">{message}</div>;
}
function Confirm({ text }: { text: string }) { return <div className="notice notice-cyan">{text}</div>; }
function MiniStat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="ops-stat"><small>{label}</small><strong>{value}</strong>{note && <span>{note}</span>}</div>;
}
function MemberPicker({ value, onChange, members, label = "العضو" }: { value: string; onChange: (value: string) => void; members: Array<{ id: number; name: string | null }> | undefined; label?: string }) {
  return <label className="field-label">{label}<select required value={value} onChange={e => onChange(e.target.value)}><option value="">اختر عضوًا</option>{members?.map(m => <option value={m.id} key={m.id}>{m.name || `#${m.id}`}</option>)}</select></label>;
}

export function AttendancePage({ user }: { user: User }) {
  const utils = trpc.useUtils();
  const status = trpc.attendance.status.useQuery(undefined, { refetchInterval: 20_000 });
  const history = trpc.attendance.history.useQuery();
  const stream = trpc.stream.status.useQuery(undefined, { refetchInterval: 15000 });
  const pulse = trpc.attendance.pulse.useMutation();
  useEffect(() => {
    if (!status.data || !stream.data?.isLive) return;
    const beat = () => { if (document.visibilityState === "visible") pulse.mutate(); };
    const timer = window.setInterval(beat, 30_000);
    return () => window.clearInterval(timer);
  }, [status.data?.id, stream.data?.isLive]);
  const members = trpc.staff.members.useQuery(undefined, { enabled: isManager(user, "manageAttendance") || isManager(user, "viewReports") });
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = async () => { await Promise.all([utils.attendance.status.invalidate(), utils.attendance.history.invalidate()]); };
  const checkIn = trpc.attendance.checkIn.useMutation({ onSuccess: async () => { setNotice("تم تسجيل الحضور."); await refresh(); } });
  const checkOut = trpc.attendance.checkOut.useMutation({ onSuccess: async () => { setNotice("تم تسجيل الانصراف وحفظ مدة الجلسة."); await refresh(); } });
  const all = history.data?.rows ?? [];
  const rows = filter ? all.filter(row => String(row.userId) === filter) : all;
  const total = rows.reduce((sum, row) => sum + row.verifiedSeconds, 0);
  return <div className="section-stack">
    <Header eyebrow="STAFF OPERATIONS" title="الحضور والانصراف" detail="تسجيل الحضور أثناء LIVE مع احتساب نبضات التواجد عندما تكون صفحة الموقع ظاهرة؛ لا يثبت نشاطك في Kick أو Discord." icon={Clock3}/>
    {notice && <Confirm text={notice}/>}
    <ErrorBox error={status.error || history.error || checkIn.error || checkOut.error}/>
    <div className="ops-stats"><MiniStat label="حالتي الآن" value={status.data ? "حاضر" : "غير حاضر"}/><MiniStat label="الجلسات المسجلة" value={rows.filter(r => r.endedAt).length}/><MiniStat label="إجمالي آخر السجلات" value={hours(total)} note="حضور الصفحة الظاهرة فقط، ولا يساوي ساعات Kick الفعلية"/></div>
    <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">MY SHIFT</span><h2>تسجيل الحضور</h2></div><Activity size={20}/></div>
      <p>{status.data ? `بدأت جلستك في ${fmt(status.data.startedAt)}` : "لم تبدأ جلسة حضور حاليًا."}</p>
      <div className="ops-actions">{status.data ? <button className="primary-button" disabled={checkOut.isPending} onClick={() => checkOut.mutate()}><TimerReset size={17}/> تسجيل انصراف</button> : <button className="primary-button" disabled={checkIn.isPending || status.isLoading || !stream.data?.isLive} onClick={() => checkIn.mutate()}><CheckCircle2 size={17}/> تسجيل حضور</button>}</div>
      <p className="ops-muted">التسجيل لا يبدأ إلا أثناء LIVE. كل 30 ثانية من ظهور الصفحة يتم إرسال نبضة محمية للخادم. إذا أخفيت الصفحة أو انقطع الاتصال فلن تستمر دقائق التواجد في الزيادة.</p>
    </section>
    <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">SHIFT LOG</span><h2>سجل الحضور</h2></div>{history.data?.canViewAll && <select value={filter} onChange={e => setFilter(e.target.value)}><option value="">كل الأعضاء</option>{members.data?.map(m => <option value={m.id} key={m.id}>{m.name || `#${m.id}`}</option>)}</select>}</div>
      {rows.length ? <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>العضو</th><th>الدخول</th><th>الخروج</th><th>المدة</th><th>السبب</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{memberName(members.data, r.userId, user)}</td><td>{fmt(r.startedAt)}</td><td>{fmt(r.endedAt)}</td><td>{hours(r.verifiedSeconds)}</td><td>{r.endedAt ? (r.endReason === "stream_end" ? "انتهاء البث" : "يدوي") : "—"}</td></tr>)}</tbody></table></div> : <div className="ops-empty">مفيش سجلات حضور حتى الآن.</div>}
    </section>
  </div>;
}

export function PointsPage({ user }: { user: User }) {
  const utils = trpc.useUtils();
  const summary = trpc.points.summary.useQuery();
  const settings = trpc.settings.get.useQuery();
  const canAward = isManager(user, "managePoints");
  const members = trpc.staff.members.useQuery(undefined, { enabled: canAward || isManager(user, "viewReports") });
  const [member, setMember] = useState("");
  const [delta, setDelta] = useState("15");
  useEffect(() => { if (settings.data?.pointsPerActivity) setDelta(String(settings.data.pointsPerActivity)); }, [settings.data?.pointsPerActivity]);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const award = trpc.points.award.useMutation({ onSuccess: async () => { setReason(""); setNotice("تم تسجيل النقاط في سجل العمليات."); await utils.points.summary.invalidate(); } });
  const totals = summary.data?.totals ?? [];
  const current = totals.find(r => r.userId === user.id);
  function submit(e: FormEvent) { e.preventDefault(); award.mutate({ userId: Number(member), delta: Number(delta), reason }); }
  return <div className="section-stack">
    <Header eyebrow="REWARDS" title="النقاط والترقيات" detail="سجل نقاط الإنجازات والترقيات من الإدارة. الحدود قابلة للتخصيص ولا تمنح صلاحيات أو رتبًا تلقائيًا." icon={Star}/>
    {notice && <Confirm text={notice}/>}<ErrorBox error={summary.error || award.error}/>
    <div className="ops-stats"><MiniStat label="نقاطك" value={current?.total ?? 0}/><MiniStat label="مستواك" value={current?.promotion.title ?? "Member"}/><MiniStat label="المتبقي للترقية" value={current?.promotion.remaining ?? 150}/></div>
    {canAward && <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">MANAGEMENT</span><h2>إضافة نقاط لمهمة</h2></div><Plus size={19}/></div>
      <form className="ops-form" onSubmit={submit}><MemberPicker members={members.data} value={member} onChange={setMember}/><label className="field-label">النقاط<select value={delta} onChange={e => setDelta(e.target.value)}><option value={settings.data?.pointsPerActivity ?? 15}>+{settings.data?.pointsPerActivity ?? 15} | إنجاز</option><option value={Math.min(150, (settings.data?.pointsPerActivity ?? 15)*2)}>+{Math.min(150, (settings.data?.pointsPerActivity ?? 15)*2)} | إنجاز متميز</option><option value={Math.min(150, (settings.data?.pointsPerActivity ?? 15)*3)}>+{Math.min(150, (settings.data?.pointsPerActivity ?? 15)*3)} | تقدير إضافي</option>{user.role === "admin" && <option value="-15">−15 | تصحيح إداري</option>}</select></label><label className="field-label ops-wide">سبب النقاط<input required minLength={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="مثال: تنظيم الشات خلال البث"/></label><button className="primary-button" disabled={award.isPending || !member}><Plus size={16}/> تسجيل النقاط</button></form>
    </section>}
    {totals.length > 0 && <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">LEADERBOARD</span><h2>رصيد الفريق</h2></div><Users size={19}/></div><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>العضو</th><th>النقاط</th><th>المستوى</th><th>القادم</th></tr></thead><tbody>{[...totals].sort((a,b) => b.total-a.total).map(r => <tr key={r.userId}><td>{memberName(members.data, r.userId, user)}</td><td><b>{r.total}</b></td><td>{r.promotion.title}</td><td>{r.promotion.next ? `${r.promotion.remaining} نقطة` : "أعلى مستوى"}</td></tr>)}</tbody></table></div></section>}
    <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">POINTS LEDGER</span><h2>سجل العمليات</h2></div><Star size={19}/></div>{summary.data?.history.length ? <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>العضو</th><th>النقاط</th><th>السبب</th><th>التاريخ</th></tr></thead><tbody>{summary.data.history.map(r => <tr key={r.id}><td>{memberName(members.data, r.userId, user)}</td><td className={r.delta > 0 ? "ops-positive" : "ops-negative"}>{r.delta > 0 ? "+" : ""}{r.delta}</td><td>{r.reason}</td><td>{fmt(r.createdAt)}</td></tr>)}</tbody></table></div> : <div className="ops-empty">سجل النقاط فاضي حتى الآن.</div>}</section>
  </div>;
}

export function AbsencesPage({ user }: { user: User }) {
  const utils = trpc.useUtils();
  const list = trpc.absences.list.useQuery();
  const canManage = isManager(user, "manageLeaves");
  const members = trpc.staff.members.useQuery(undefined, { enabled: canManage });
  const [kind, setKind] = useState<"leave" | "excuse">("excuse");
  const [startDate, setStartDate] = useState(defaultDay);
  const [endDate, setEndDate] = useState(defaultDay);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const request = trpc.absences.request.useMutation({ onSuccess: async () => { setReason(""); setNotice("تم إرسال الطلب للإدارة."); await utils.absences.list.invalidate(); } });
  const review = trpc.absences.review.useMutation({ onSuccess: async () => { setNotice("تم حفظ قرار الإدارة."); await utils.absences.list.invalidate(); } });
  const items = list.data?.rows ?? [];
  const statusNames = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" } as const;
  function submit(e: FormEvent) { e.preventDefault(); request.mutate({ kind, startDate, endDate: kind === "excuse" ? startDate : endDate, reason }); }
  return <div className="section-stack">
    <Header eyebrow="TIME OFF" title="الإجازات والأعذار اليومية" detail="قدّم عذرًا ليوم واحد أو إجازة من يوم إلى 30 يومًا، وتابع قرار الإدارة." icon={CalendarDays}/>
    {notice && <Confirm text={notice}/>}<ErrorBox error={list.error || request.error || review.error}/>
    <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">NEW REQUEST</span><h2>طلب جديد</h2></div><Plus size={19}/></div>
      <form className="ops-form" onSubmit={submit}><label className="field-label">نوع الطلب<select value={kind} onChange={e => setKind(e.target.value as "leave" | "excuse")}><option value="excuse">عذر يومي</option><option value="leave">إجازة</option></select></label><label className="field-label">من تاريخ<input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)}/></label>{kind === "leave" && <label className="field-label">إلى تاريخ<input type="date" required min={startDate} value={endDate} onChange={e => setEndDate(e.target.value)}/></label>}<label className="field-label ops-wide">السبب<textarea required minLength={10} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="اكتب تفاصيل الطلب بوضوح" rows={3}/></label><button className="primary-button" disabled={request.isPending}><Plus size={16}/> إرسال الطلب</button></form>
    </section>
    <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">REQUESTS</span><h2>{canManage ? "طلبات الفريق" : "طلباتي"}</h2></div><span className="count-badge">{items.length}</span></div>
      {items.length ? <div className="ops-rows">{items.map(r => <article key={r.id} className="ops-entry"><div className="ops-entry-main"><div className="ops-entry-top"><b>{r.kind === "leave" ? "إجازة" : "عذر يومي"} | {memberName(members.data, r.userId, user)}</b><span className={`ops-status ${r.status}`}>{statusNames[r.status]}</span></div><p>{r.reason}</p><small>{r.startDate}{r.endDate !== r.startDate ? ` ← ${r.endDate}` : ""} · أُرسل {fmt(r.createdAt)}</small>{r.reviewedNote && <small>تعليق الإدارة: {r.reviewedNote}</small>}</div>{canManage && r.status === "pending" && r.userId !== user.id && <div className="ops-entry-actions"><button className="secondary-button" disabled={review.isPending} onClick={() => review.mutate({ id: r.id, status: "approved" })}><CheckCircle2 size={15}/> قبول</button><button className="ban-button" disabled={review.isPending} onClick={() => { const note = window.prompt("سبب الرفض (اختياري)") || ""; review.mutate({ id: r.id, status: "rejected", note }); }}>رفض</button></div>}</article>)}</div> : <div className="ops-empty">لا توجد طلبات حتى الآن.</div>}
    </section>
  </div>;
}

export function DisciplinePage({ user }: { user: User }) {
  const utils = trpc.useUtils();
  const list = trpc.discipline.list.useQuery();
  const canManage = isManager(user, "manageDiscipline");
  const members = trpc.staff.members.useQuery(undefined, { enabled: canManage });
  const [member, setMember] = useState("");
  const [level, setLevel] = useState<"notice" | "warning" | "strike">("warning");
  const [reason, setReason] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [notice, setNotice] = useState("");
  const issue = trpc.discipline.issue.useMutation({ onSuccess: async () => { setReason(""); setEvidenceUrl(""); setNotice("تم توثيق المخالفة."); await utils.discipline.list.invalidate(); } });
  const rescind = trpc.discipline.rescind.useMutation({ onSuccess: async () => { setNotice("تم إلغاء المخالفة مع الاحتفاظ بسجلها."); await utils.discipline.list.invalidate(); } });
  const names = { notice: "ملاحظة", warning: "إنذار", strike: "مخالفة جسيمة" } as const;
  const records = list.data?.rows ?? [];
  function submit(e: FormEvent) { e.preventDefault(); issue.mutate({ userId: Number(member), level, reason, evidenceUrl }); }
  return <div className="section-stack">
    <Header eyebrow="MODERATION" title="المخالفات والإنذارات" detail="سجل واضح للإنذارات والملاحظات مع السبب ودليل اختياري. الإلغاء يحفظ الأثر بدل حذف السجل." icon={ShieldAlert}/>
    {notice && <Confirm text={notice}/>}<ErrorBox error={list.error || issue.error || rescind.error}/>
    <div className="ops-stats"><MiniStat label="السجلات" value={records.length}/><MiniStat label="إنذارات ومخالفات نشطة" value={records.filter(r => !r.rescindedAt && r.level !== "notice").length}/></div>
    {canManage && <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">ISSUE ACTION</span><h2>تسجيل مخالفة</h2></div><AlertTriangle size={19}/></div><form className="ops-form" onSubmit={submit}><MemberPicker members={members.data} value={member} onChange={setMember}/><label className="field-label">المستوى<select value={level} onChange={e => setLevel(e.target.value as typeof level)}><option value="notice">ملاحظة</option><option value="warning">إنذار</option><option value="strike">مخالفة جسيمة</option></select></label><label className="field-label ops-wide">السبب<textarea required minLength={10} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} rows={3}/></label><label className="field-label ops-wide">رابط الدليل (اختياري، HTTPS)<input type="url" value={evidenceUrl} onChange={e => setEvidenceUrl(e.target.value)} placeholder="https://..."/></label><button className="primary-button" disabled={issue.isPending || !member}><ShieldAlert size={16}/> تسجيل المخالفة</button></form></section>}
    <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">ACTION LOG</span><h2>{canManage ? "سجل الفريق" : "سجلي"}</h2></div><span className="count-badge">{records.length}</span></div>
      {records.length ? <div className="ops-rows">{records.map(r => <article className="ops-entry" key={r.id}><div className="ops-entry-main"><div className="ops-entry-top"><b>{memberName(members.data, r.userId, user)}</b><span className={`ops-status ${r.rescindedAt ? "rejected" : r.level === "notice" ? "pending" : "active"}`}>{r.rescindedAt ? "ملغاة" : names[r.level]}</span></div><p>{r.reason}</p><small>{fmt(r.createdAt)}{r.rescindedAt ? ` · ألغيت ${fmt(r.rescindedAt)}` : ""}</small>{r.evidenceUrl && <a href={r.evidenceUrl} target="_blank" rel="noopener noreferrer">عرض الدليل</a>}</div>{canManage && !r.rescindedAt && r.userId !== user.id && <button className="secondary-button" disabled={rescind.isPending} onClick={() => { if (window.confirm("إلغاء المخالفة مع الحفاظ على السجل؟")) rescind.mutate({ id: r.id }); }}><MinusCircle size={15}/> إلغاء</button>}</article>)}</div> : <div className="ops-empty">لا توجد مخالفات مسجلة.</div>}
    </section>
  </div>;
}

function csvCell(value: string | number) {
  // Excel formula injection protection for any free-text member names.
  const input = String(value);
  const safe = /^[=+\-@\t\r]/.test(input) ? `'${input}` : input;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function ReportsPage() {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [offset, setOffset] = useState(0);
  const report = trpc.reports.period.useQuery({ period, offset });
  const entries = report.data?.entries ?? [];
  const totals = useMemo(() => entries.reduce((s, e) => ({ hours: s.hours + e.hours, points: s.points + e.points, warnings: s.warnings + e.warnings }), { hours: 0, points: 0, warnings: 0 }), [entries]);
  function exportCsv() {
    if (!report.data) return;
    const header = ["العضو", "الفريق", "مرات الحضور", "الساعات", "النقاط", "الإنذارات", "الملاحظات", "الأعذار المقبولة"];
    const csv = [header, ...entries.map(r => [r.name || `#${r.id}`, r.team === "main" ? "أساسي" : "احتياطي", r.attendanceSessions, r.hours, r.points, r.warnings, r.notices, r.approvedAbsences])].map(row => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `kickmod-${period}-report.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  return <div className="section-stack"><Header eyebrow="ANALYTICS" title="التقارير والأداء" detail="تقارير أسبوعية وشهرية محسوبة من سجلات الحضور والنقاط والمخالفات والطلبات المقبولة. التواريخ حسب توقيت قطر." icon={Activity}/>
    <ErrorBox error={report.error}/>
    <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">PERIOD FILTER</span><h2>الفترة: {report.data?.label || "..."}</h2></div><div className="ops-actions"><select value={period} onChange={e => { setPeriod(e.target.value as typeof period); setOffset(0); }}><option value="week">أسبوعي</option><option value="month">شهري</option></select><button type="button" className="secondary-button" onClick={() => setOffset(v => Math.min(12, v + 1))} disabled={offset >= 12}>السابق</button><button type="button" className="secondary-button" onClick={() => setOffset(v => Math.max(0, v - 1))} disabled={offset === 0}>التالي</button><button type="button" className="secondary-button" disabled={!report.data} onClick={exportCsv}><FileDown size={16}/> CSV</button></div></div><p className="ops-muted">الساعات هي دقائق حضور الصفحة الظاهرة فقط، وليست بيانات Kick أو Discord الفعلية. الأعذار المقبولة المتداخلة مع الفترة تُحسب كطلبات، مش أيام.</p></section>
    <div className="ops-stats"><MiniStat label="أعضاء الفريق" value={entries.length}/><MiniStat label="ساعات حضور الصفحة" value={totals.hours.toFixed(2)}/><MiniStat label="نقاط الفترة" value={totals.points}/><MiniStat label="إنذارات فعالة" value={totals.warnings}/></div>
    <section className="content-card ops-card"><div className="card-heading"><div><span className="eyebrow">TEAM PERFORMANCE</span><h2>أداء المودات</h2></div><Activity size={19}/></div>
    {entries.length ? <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>العضو</th><th>الفريق</th><th>حضور</th><th>ساعات</th><th>نقاط</th><th>إنذارات</th><th>أعذار مقبولة</th></tr></thead><tbody>{entries.map(row => <tr key={row.id}><td><b>{row.name || `#${row.id}`}</b></td><td><span className={`ops-status ${row.team === "main" ? "approved" : "pending"}`}>{row.team === "main" ? "أساسي" : "احتياطي"}</span></td><td>{row.attendanceSessions}</td><td>{row.hours.toFixed(2)}</td><td>{row.points}</td><td>{row.warnings}</td><td>{row.approvedAbsences}</td></tr>)}</tbody></table></div> : <div className="ops-empty">لا توجد حسابات معتمدة لإعداد التقرير.</div>}</section>
  </div>;
}
