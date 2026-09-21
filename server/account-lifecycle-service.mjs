const fail = (status, message) => Object.assign(new Error(message), { status });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operations = new Set(['suspend', 'suspend-until', 'reactivate', 'delete']);

export function validateAccountLifecycle(input, user, token, now = Date.now()) {
  if (!user || user.is_anonymous || user.deleted_at || user.app_metadata?.role !== 'super_admin'
      || ['true', true].includes(user.app_metadata?.must_change_password)
      || Date.parse(user.banned_until || '') > now) {
    throw fail(403, 'إدارة حالة الحساب متاحة للسوبر أدمن فقط');
  }
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch {}
  // The account service verifies this bearer with Auth getUser before this call
  // The database independently verifies the session against auth.sessions
  if (!uuid.test(claims?.session_id || '') || claims?.sub !== user.id) {
    throw fail(401, 'انتهت الجلسة سجل الدخول مجددا');
  }
  if (!uuid.test(input.userId || '') || !operations.has(input.operation)) {
    throw fail(400, 'اختر حسابا وإجراء صحيحين');
  }
  if (input.userId.toLowerCase() === user.id.toLowerCase()) {
    throw fail(403, 'لا يمكن إيقاف حسابك الحالي أو حذفه');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 3 || reason.length > 1000) {
    throw fail(400, 'اكتب سبب الإجراء من ثلاثة إلى ألف حرف');
  }
  let until = null;
  if (input.operation === 'suspend-until') {
    const raw = typeof input.until === 'string' ? input.until : '';
    const parsed = Date.parse(raw);
    const calendar = Date.parse(`${raw.slice(0, 10)}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(raw)
        || !Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== raw.slice(0, 10)
        || !Number.isFinite(parsed) || parsed < now + 60000 || parsed > now + 366 * 86400000) {
      throw fail(400, 'حدد نهاية للإيقاف بعد دقيقة على الأقل وخلال سنة');
    }
    until = new Date(parsed).toISOString();
  } else if (input.until != null && input.until !== '') {
    throw fail(400, 'موعد انتهاء الإيقاف متاح للإيقاف المؤقت فقط');
  }
  const confirmation = typeof input.confirmation === 'string' ? input.confirmation.trim().toLowerCase() : '';
  if (input.operation === 'delete' && (!confirmation || confirmation.length > 254)) {
    throw fail(400, 'اكتب بريد الحساب لتأكيد الحذف النهائي');
  }
  return { userId: input.userId, operation: input.operation, reason, until, confirmation, sessionId: claims.session_id };
}

function databaseFailure(result) {
  if (!result.error) return result.data;
  const message = String(result.error.message || '');
  if (result.error.code === '42501' || /forbidden|session_expired|self_action|last_owner/.test(message)) {
    throw fail(403, 'لا تملك صلاحية هذا الإجراء أو انتهت الجلسة');
  }
  if (/account_deleted/.test(message)) throw fail(409, 'الحساب محذوف نهائيا ولا يمكن إعادة تفعيله');
  if (/confirmation_mismatch/.test(message)) throw fail(400, 'البريد المكتوب لا يطابق بريد الحساب');
  if (/account_not_found/.test(message)) throw fail(404, 'لم يتم العثور على الحساب');
  if (result.error.code === '22023') throw fail(400, 'راجع سبب الإجراء وموعد الإيقاف');
  throw fail(502, 'تعذر تحديث حالة الحساب حاول مجددا');
}

export function accountLifecycleService(admin) {
  return async (input, user, token) => {
    const value = validateAccountLifecycle(input, user, token);
    const result = databaseFailure(await admin.rpc('platform_account_lifecycle', {
      p_actor: user.id,
      p_session: value.sessionId,
      p_user: value.userId,
      p_operation: value.operation,
      p_reason: value.reason,
      p_until: value.until,
      p_confirmation: value.confirmation,
    }));
    if (value.operation !== 'delete' || result.identity_deleted) return { success: true, ...result };

    // Access and refresh sessions are revoked atomically before Auth deletion
    // Soft deletion invalidates the identity while preserving foreign key history
    // A failed Auth request never rolls back the permanent application tombstone
    let removed = false;
    try {
      const removal = await admin.auth.admin.deleteUser(value.userId, true);
      removed = !removal.error;
    } catch {}
    if (!removed) return { success: true, ...result, identity_cleanup_pending: true };
    try {
      const completed = databaseFailure(await admin.rpc('platform_account_deletion_finish', {
        p_actor: user.id, p_session: value.sessionId, p_user: value.userId,
      }));
      return { success: true, ...completed };
    } catch {
      // Auth may have succeeded even when the completion RPC was interrupted
      // The next directory read and a retry determine completion from deleted_at
      return { success: true, ...result, identity_cleanup_pending: true };
    }
  };
}
