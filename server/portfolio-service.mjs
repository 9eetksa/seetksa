import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const packaged = /^\/portfolio\/(saudi-dent|one-minute|sukkar|hdeer)(-portrait\.webp|\.jpg)$/;
const failure = (status, message) => Object.assign(new Error(message), { status });
const unwrap = response => {
  if (response.error) throw failure(502, 'تعذر إكمال العملية تحقق من الاتصال وأعد المحاولة');
  return response.data;
};
const storagePath = (work, file) => file.source === 'storage'
  && typeof file.object_path === 'string'
  && new RegExp(`^${work.id}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.[a-z0-9]{1,8}$`).test(file.object_path);

export function safeProjectUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function createPortfolioService(env, { createSupabaseClient = createClient } = {}) {
  let admin;
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: WebSocket },
    global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
  };
  function database() {
    if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
      throw failure(503, 'عرض الأعمال غير متاح حاليا');
    return admin ||= createSupabaseClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);
  }
  return {
    async list() {
      const db = database();
      // Only published display fields cross the public boundary. Originals and archives stay private.
      const rows = unwrap(await db.from('portfolio_works')
        .select('id,name,description,project_url,status,portfolio_media(source,object_path,is_cover,position)')
        .eq('status', 'active').order('created_at', { ascending: true }).order('id').limit(50));
      const works = (rows || []).filter(work => work.status === 'active').map(work => ({
        ...work, cover: work.portfolio_media?.find(file => file.is_cover),
      }));
      const paths = works.filter(work => work.cover && storagePath(work, work.cover)).map(work => work.cover.object_path);
      const signed = paths.length ? unwrap(await db.storage.from('portfolio-assets').createSignedUrls(paths, 120)) : [];
      const urls = new Map((signed || []).filter(file => !file.error).map(file => [file.path, file.signedUrl]));
      return works.map(work => ({
        id: work.id, name: work.name, description: work.description,
        url: safeProjectUrl(work.project_url),
        image: work.cover?.source === 'packaged' && packaged.test(work.cover.object_path)
          ? work.cover.object_path : urls.get(work.cover?.object_path) || null,
      }));
    },
    async remove(input, token) {
      if (!uuid.test(input?.id || '') || !Number.isSafeInteger(input?.version) || input.version < 1)
        throw failure(400, 'بيانات العمل غير صالحة');
      if (typeof token !== 'string' || token.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token))
        throw failure(401, 'سجل الدخول للمتابعة');
      const db = database();
      const scoped = createSupabaseClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
        ...options, global: { ...options.global, headers: { Authorization: `Bearer ${token}` } },
      });
      // This checks the live account and auth.sessions, not stale role claims in a token.
      const access = await scoped.rpc('platform_access_check', { p_allow_onboarding: false });
      if (access.error || !access.data?.user_id || !['admin', 'super_admin'].includes(access.data.role))
        throw failure(403, 'حذف الأعمال متاح للأدمن والسوبر أدمن فقط');
      // Also require visibility through the existing portfolio RLS policy.
      const visible = await scoped.from('portfolio_works').select('id,version,portfolio_media(source,object_path)').eq('id', input.id).maybeSingle();
      if (visible.error) throw failure(403, 'غير مصرح بحذف هذا العمل');
      if (!visible.data) return { success: true, alreadyDeleted: true };
      if (visible.data.version !== input.version) throw failure(409, 'تغير العمل لدى مستخدم آخر حدّث المكتبة قبل الحذف');
      // The version predicate prevents deleting a concurrently saved revision; FK cascades remove media records.
      const deleted = unwrap(await db.from('portfolio_works').delete().eq('id', input.id).eq('version', input.version).select('id'));
      if (!deleted?.length) throw failure(409, 'تغير العمل لدى مستخدم آخر حدّث المكتبة قبل الحذف');
      const paths = (visible.data.portfolio_media || []).filter(file => storagePath(visible.data, file)).map(file => file.object_path);
      let cleanupPending = false;
      // Storage objects must be removed through its API, never by editing storage.objects.
      for (let offset = 0; offset < paths.length; offset += 100) {
        try {
          const result = await db.storage.from('portfolio-assets').remove(paths.slice(offset, offset + 100));
          cleanupPending ||= Boolean(result.error);
        } catch { cleanupPending = true; }
      }
      return { success: true, cleanupPending };
    },
  };
}
