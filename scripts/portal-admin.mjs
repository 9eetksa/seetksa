// Run only from a trusted administrator workstation
// node --env-file=.env.local scripts/portal-admin.mjs list
// node --env-file=.env.local scripts/portal-admin.mjs set-role USER_ID client|employee
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { rolePaths } from '../src/auth/access.js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing server-side Supabase credentials');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } });
const [command, target, role] = process.argv.slice(2);
const fail = error => { if (error) throw new Error(`Supabase operation failed: ${error.code || error.status || 'unknown'}`); };

if (command === 'list') {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  fail(error);
  console.table(data.users.map(user => ({ id: user.id, email: user.email, role: user.app_metadata.role || 'unassigned' })));
  console.log(`Total users: ${data.total}`);
} else if (command === 'set-role' && /^[0-9a-f-]{36}$/i.test(target || '') && Object.hasOwn(rolePaths, role)) {
  const { data: current, error: readError } = await admin.auth.admin.getUserById(target);
  fail(readError);
  const { error } = await admin.auth.admin.updateUserById(target, { app_metadata: { ...current.user.app_metadata, role } });
  fail(error);
  console.log('Server-managed role updated');
} else {
  throw new Error('Use list or set-role USER_ID client|employee');
}
