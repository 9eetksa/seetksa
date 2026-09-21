// Validate the guarded migration against read-only live function definitions in isolated PostgreSQL
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../.tools/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const snapshot=JSON.parse(readFileSync(process.argv[2],'utf8'));
const fixture=readFileSync('tests/sql/department-client-inquiries.mjs','utf8');
const start=fixture.indexOf('const db=new PGlite()');
const end=fixture.indexOf("await db.exec(sql('20260920082026_client_google_drive_resources.sql'));");
assert(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const db=await new AsyncFunction('PGlite','readFileSync','assert',fixture.slice(start,end)+'return db;')(PGlite,readFileSync,assert);
await db.exec('set check_function_bodies=false');
for(const row of snapshot.rows){
 assert(row.schema==='public'&&['work_department_inquiry_action','work_department_inquiries'].includes(row.name));
 await db.exec(row.definition);
}
await db.exec(readFileSync('supabase/migrations/20260920082026_client_google_drive_resources.sql','utf8'));
const {rows}=await db.query("select pg_get_functiondef('public.work_department_inquiry_action(text,jsonb)'::regprocedure) as definition");
assert(rows[0].definition.includes('output_accept_required'));
assert(rows[0].definition.includes('i.response_drive_url is distinct from drive_url'));
assert(rows[0].definition.includes('response_drive_url=drive_url'));
console.log('PASS live inquiry definitions accept the Drive migration and retain existing output acceptance and replay guards');
await db.close();
