import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;
export function getSupabase() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase غير مهيأ. أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY على Vercel.");
  if (!client) client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** Exchange a verified Supabase session for an httpOnly, server-revocable portal session. */
export async function syncSupabaseSession() {
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session) throw new Error("جلسة تسجيل الدخول غير موجودة أو انتهت.");
  const response = await fetch("/api/auth/supabase/session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
    body: "{}",
  });
  const result = await response.json() as { status?: string; message?: string };
  if (!response.ok) throw new Error(result.message || "تعذر تأكيد تسجيل الدخول.");
  return result;
}
