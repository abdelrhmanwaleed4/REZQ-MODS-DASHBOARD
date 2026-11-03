# REZK MODS V3 | Vercel + Supabase

تم تحويل كود قاعدة البيانات من MySQL إلى PostgreSQL، وتسجيل الدخول إلى Supabase Auth، وفصل Express API كـ Vercel Function. تصميم الموقع والصور الأربعة لم يتغيروا.

## 1) Supabase: أنشئ مشروعًا جديدًا

1. افتح https://supabase.com/dashboard وأنشئ مشروعًا جديدًا.
2. افتح **SQL Editor** والصق محتوى `supabase/001_schema.sql` بالكامل واضغط Run **مرة واحدة على قاعدة بيانات جديدة**. ينشئ 33 جدولًا وفهارسها وروابطها، ويفعّل RLS عليها جميعًا. لا توجد سياسات قراءة عامة. لا تستخدم SQL القديم من مجلد `drizzle/*.mysql.sql.txt`.
3. افتح **Project Settings → API Keys** وخذ Project URL والمفتاح Publishable (أو anon legacy).
4. من زر **Connect** اختر **Transaction pooler** واتركه للمتغير `DATABASE_URL` الخاص بالخادم. تأكد أن كلمة المرور مستبدلة بمرور قاعدة البيانات الحقيقي (مع URL encoding للرموز الخاصة).

## 2) Supabase Auth + Google

1. من **Authentication → Providers → Email** فعّل Email إن كنت تريد تسجيل الحسابات بالبريد. يفضّل إبقاء تأكيد الإيميل مفعّلًا.
2. من **Authentication → Providers → Google** فعّل Google وأدخل Google OAuth Client ID وClient Secret **داخل Supabase فقط**.
3. في Google Cloud Console، أضف Redirect URI الرسمي الظاهر في Supabase: `https://PROJECT_REF.supabase.co/auth/v1/callback` (غيّر PROJECT_REF لقيمة مشروعك). لا تستخدم `/api/auth/google/callback` القديم.
4. من Supabase **Authentication → URL Configuration** اضبط Site URL على `https://YOUR-APP.vercel.app`، وأضف `https://YOUR-APP.vercel.app/login` إلى Redirect URLs. أضف رابط `http://localhost:3000/login` للتجارب المحلية فقط.
5. إيميل المدير الأول يجب أن يطابق `INITIAL_ADMIN_EMAIL` وأن يكون مؤكدًا داخل Supabase Auth. باقي الأعضاء يدخلون بصفة pending لحد ما توافق عليهم الإدارة.

## 3) Vercel: انشر الملفات

1. فك ZIP وارفع **محتويات `kickmod`** إلى GitHub Private repo، بحيث `package.json` و `vercel.json` و `api/index.ts` في جذر المستودع. لا ترفع `.env` الحقيقي.
2. افتح https://vercel.com/new → Import Git Repository.
3. في إعداد المشروع: **Root Directory** = `./` إذا رفعت محتويات `kickmod` مباشرة. Framework = Vite، Build Command = `npm run build:static`، Output Directory = `dist/public`، Install Command = `npm install`، Node.js = 22.x. `vercel.json` موجود بالفعل.
4. من Settings → Environment Variables أضف المتغيرات أدناه في Production (وممكن Preview بقيم مناسبة). **أضف VITE_ قبل البناء** لأن Vite يدمج القيم العامة وقت الـbuild. ثم اعمل Redeploy.
5. بعد نجاح النشر افتح `https://YOUR-APP.vercel.app/api/health`؛ يُفترض إرجاع JSON بحالة ok. بعد ذلك افتح `/login`، جرّب Google أو إيميل مؤكد، ثم لوحة التحكم.

## 4) المتغيرات (Vercel Environment Variables)

| المتغير | المصدر | ملاحظة |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase Project URL | عام للمتصفح |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable / anon | عام للمتصفح، **ليس** service role |
| `SUPABASE_URL` | نفس Project URL | مستخدم للتحقق من هوية Supabase في API |
| `SUPABASE_ANON_KEY` | نفس publishable / anon | السيرفر يتحقق من access token عن طريق Supabase Auth |
| `DATABASE_URL` | Supabase → Connect → Transaction pooler (6543) | **سري جدًا**، URL يبدأ بـ`postgresql://` وليس MySQL |
| `PUBLIC_APP_ORIGIN` | رابط Vercel النهائي (https) | بدون slash في النهاية |
| `APP_SESSION_SECRET` | `openssl rand -base64 32` | سري وفريد: يحمي جلسات الموقع |
| `INITIAL_ADMIN_EMAIL` | إيميلك المؤكد في Supabase | يدخل تلقائيًا كمدير أول |
| `DISCORD_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` مستقل | سر تشفير توكن البوت |
| `LINK_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` مستقل | سر تشفير رموز OAuth المرتبطة؛ Base64 32 bytes |
| `AUTOMOD_HASH_PEPPER` | `openssl rand -base64 32` مستقل | سر تجزئة بيانات AutoMod |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Discord Developer Portal OAuth2 | **اختياري** لربط الحسابات |
| `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` | Kick Developer | **اختياري** لربط Kick |
| `KICK_BROADCASTER_USER_ID` | معرف صاحب قناة Kick الموثّق | اختياري لتكامل القناة |

**لا تضع إطلاقًا** `DATABASE_URL` أو أي Client Secret أو توكن Discord في متغير يبدأ بـ`VITE_` أو في GitHub. `service_role` غير مطلوب للنسخة دي؛ بيانات التطبيق محمية بـRLS ويتم الوصول إليها من API باستخدام اتصال PostgreSQL خاص بالخادم.

## 5) حدود Vercel المهمة

- **يعمل على Vercel:** واجهة React، صفحات الإدارة، MySQL→PostgreSQL عبر Supabase، تسجيل Google/email عبر Supabase Auth، tRPC API، قاعدة البيانات، الرتب، الحسابات، النقاط، الإعلانات، البلاغات، الجداول، Kick webhooks الموقّعة، عمليات Discord REST المتاحة بالبوت.
- **لا يعمل كخدمة مستمرة على Vercel وحده:** Discord Gateway الطويل (Join-to-Create الفوري وحذف الروم عند الخروج، AutoMod الفوري لرسائل Discord، polling الطويل)، وكذلك polling Kick المستمر. الكود الأصلي لهذه الميزات محفوظ لخادم Node منفصل **اختياري** لاحقًا، ولم يُفعَّل تلقائيًا في Vercel Functions. `RUN_PERSISTENT_WORKERS=0` في Vercel.
- Kick Webhook قابل للاستخدام على `https://YOUR-APP.vercel.app/api/kick/webhook` بعد الإعداد الرسمي الصحيح. قد تحتاج تفعيل الأحداث و OAuth وربط المالك أولًا.
- Vercel وSupabase لا يشغّلان WebSocket Bot دائمًا بالتصميم الحالي. لو عايز كل الرومات المؤقتة تعمل تلقائيًا، يلزم استضافة عامل Discord دائم التشغيل منفصل، أو تغيير النظام نفسه.

## 6) تشغيل محلي (اختياري)

```bash
npm install
cp .env.example .env
# ضع القيم الفعلية في .env، ونفّذ SQL من Supabase SQL Editor أولًا
npm run dev
```

الرابط المحلي الافتراضي: `http://localhost:3000`.

## 7) ترحيل بيانات قديمة

الملف `supabase/001_schema.sql` **ينشئ الجداول فقط**. لا ينقل تلقائيًا بيانات MySQL القديمة من استضافة Manus/خوادم أخرى. لا تحذف قاعدة بياناتك القديمة قبل تصديرها وأخذ نسخة احتياطية. حسابات Supabase Auth تحتاج تأكيد بريد من جديد، وكلمات مرور تسجيل الدخول القديمة لا تُستورد إلى Supabase تلقائيًا. بيانات الرتب والتقارير السابقة تحتاج ترحيل بيانات مستقل إذا كان عندك بيانات حقيقية بالفعل.

## 8) حالة الفحص

تم فحص تركيب TypeScript/TSX لجميع ملفات المشروع، وتناسق تعريفات الجداول، وتطابق الصور الأصلية. لم يجرِ `npm install` / `npm run build` أو تجربة قاعدة بيانات أو OAuth حقيقية في هذه البيئة لأن الاتصال بمستودع npm غير متاح. اختبر النشر على Preview قبل أي بيانات إنتاجية.
