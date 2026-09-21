import test from 'node:test';
import assert from 'node:assert/strict';
import { accountLifecycleService, validateAccountLifecycle } from '../server/account-lifecycle-service.mjs';

const ownerId = '10000000-0000-4000-8000-000000000001';
const targetId = '10000000-0000-4000-8000-000000000002';
const sessionId = '10000000-0000-4000-8000-000000000003';
const owner = { id: ownerId, app_metadata: { role: 'super_admin' } };
const token = (claims = {}) => `header.${Buffer.from(JSON.stringify({ sub: ownerId, session_id: sessionId, ...claims })).toString('base64url')}.signature`;
const base = { action: 'account-lifecycle', userId: targetId, operation: 'suspend', reason: 'مراجعة إجراء الإحالة' };
const now = Date.parse('2026-09-12T12:00:00Z');

test('lifecycle denies every role except an active ready super admin', () => {
  for (const user of [null, { ...owner, is_anonymous: true }, { ...owner, deleted_at: '2026-09-01T00:00:00Z' },
    { ...owner, banned_until: '2099-01-01T00:00:00Z' },
    ...['admin', 'employee', 'client'].map(role => ({ ...owner, app_metadata: { role } })),
    ...[true, 'true'].map(must_change_password => ({ ...owner, app_metadata: { role: 'super_admin', must_change_password } })),
  ]) assert.throws(() => validateAccountLifecycle(base, user, token(), now), { status: 403 });
});

test('lifecycle rejects self mutation and session mismatch before sending a request', () => {
  assert.throws(() => validateAccountLifecycle({ ...base, userId: ownerId }, owner, token(), now), { status: 403 });
  for (const value of ['invalid', token({ session_id: 'invalid' }), token({ sub: targetId })]) {
    assert.throws(() => validateAccountLifecycle(base, owner, value, now), { status: 401 });
  }
});

test('temporary suspension requires a real future zoned timestamp within a year', () => {
  const input = { ...base, operation: 'suspend-until' };
  for (const until of [null, '', 'garbage', '2026-09-12T13:00', '2026-09-12T11:59:00Z',
    '2026-09-12T12:00:30Z', '2028-01-01T00:00:00Z', '2027-02-30T12:00:00Z', '2026-09-12T24:01:00Z']) {
    assert.throws(() => validateAccountLifecycle({ ...input, until }, owner, token(), now), { status: 400 });
  }
  assert.equal(validateAccountLifecycle({ ...input, until: '2026-09-12T16:00:00+03:00' }, owner, token(), now).until, '2026-09-12T13:00:00.000Z');
});

test('lifecycle rejects missing reasons unknown operations invalid IDs and delete without confirmation', () => {
  for (const fields of [{ reason: '' }, { reason: 'A'.repeat(1001) }, { userId: '1' }, { operation: 'restore-deleted' },
    { operation: 'delete' }, { operation: 'reactivate', until: '2026-09-13T00:00:00Z' }]) {
    assert.throws(() => validateAccountLifecycle({ ...base, ...fields }, owner, token(), now), { status: 400 });
  }
});

function fakeAdmin({ rpcError, removalError, finishError, alreadyDeleted = false } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'platform_account_deletion_finish') return { data: { access_status: 'deleted', identity_deleted: true, identity_cleanup_pending: false }, error: finishError };
      return { data: { access_status: args.p_operation === 'delete' ? 'deleted' : 'suspended', identity_deleted: alreadyDeleted }, error: rpcError };
    },
    auth: { admin: { deleteUser: async (...args) => { calls.push({ name: 'deleteUser', args }); return { error: removalError }; } } },
  };
}

test('suspension passes the verified actor and exact session to the service-only database boundary', async () => {
  const admin = fakeAdmin();
  const result = await accountLifecycleService(admin)(base, owner, token());
  assert.equal(result.access_status, 'suspended');
  assert.deepEqual(admin.calls, [{ name: 'platform_account_lifecycle', args: {
    p_actor: ownerId, p_session: sessionId, p_user: targetId, p_operation: 'suspend',
    p_reason: base.reason, p_until: null, p_confirmation: '',
  } }]);
});

test('database session revocation or demotion denial prevents Auth deletion', async () => {
  for (const message of ['forbidden', 'session_expired', 'last_owner']) {
    const admin = fakeAdmin({ rpcError: { message, code: '42501' } });
    await assert.rejects(accountLifecycleService(admin)({ ...base, operation: 'delete', confirmation: 'account@example.com' }, owner, token()), { status: 403 });
    assert.equal(admin.calls.length, 1);
  }
});

test('delete uses irreversible Auth soft deletion only after the permanent access tombstone', async () => {
  const admin = fakeAdmin();
  const result = await accountLifecycleService(admin)({ ...base, operation: 'delete', confirmation: ' ACCOUNT@example.com ' }, owner, token());
  assert.equal(admin.calls[0].args.p_confirmation, 'account@example.com');
  assert.deepEqual(admin.calls.map(call => call.name), ['platform_account_lifecycle', 'deleteUser', 'platform_account_deletion_finish']);
  assert.deepEqual(admin.calls[1].args, [targetId, true]);
  assert.equal(result.identity_deleted, true);
  assert.equal(result.identity_cleanup_pending, false);
});

test('Auth cleanup failure stays permanently disabled and reports retryable cleanup honestly', async () => {
  const admin = fakeAdmin({ removalError: { message: 'unavailable' } });
  const result = await accountLifecycleService(admin)({ ...base, operation: 'delete', confirmation: 'account@example.com' }, owner, token());
  assert.equal(result.access_status, 'deleted');
  assert.equal(result.identity_cleanup_pending, true);
  assert.deepEqual(admin.calls.map(call => call.name), ['platform_account_lifecycle', 'deleteUser']);
});

test('deleted accounts cannot be reactivated and identity cleanup never repeats after success', async () => {
  const deleted = fakeAdmin({ rpcError: { message: 'account_deleted' } });
  await assert.rejects(accountLifecycleService(deleted)({ ...base, operation: 'reactivate' }, owner, token()), { status: 409 });
  const complete = fakeAdmin({ alreadyDeleted: true });
  await accountLifecycleService(complete)({ ...base, operation: 'delete', confirmation: 'account@example.com' }, owner, token());
  assert.equal(complete.calls.length, 1);
});
