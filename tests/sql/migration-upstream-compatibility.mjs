// Read-only pg_get_functiondef snapshots may be supplied to validate unapplied migrations
// Runs only in isolated PGlite and never connects to a production database
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../.tools/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const snapshotPath=process.argv[2];
assert(snapshotPath,'provide read-only function-definition JSON snapshot');
const raw=readFileSync(snapshotPath);
const snapshot=JSON.parse(raw.toString(raw[0]===255&&raw[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,''));
const fixture=readFileSync('tests/sql/department-output-tasks.mjs','utf8');
const start=fixture.indexOf('const db=new PGlite();');
const end=fixture.indexOf("await db.exec(sql('20260918221141_department_output_tasks.sql'));");
assert(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const db=await new AsyncFunction('PGlite','readFileSync','assert',fixture.slice(start,end)+'return db;')(PGlite,readFileSync,assert);
// Supabase-only referenced functions are not executed in this shape compatibility check
await db.exec('set check_function_bodies=false');
for(const row of snapshot.rows){assert(['public','provision_private'].includes(row.schema));assert(row.definition.startsWith('CREATE OR REPLACE FUNCTION '));await db.exec(row.definition);}
await db.exec('set check_function_bodies=true');
for(const migration of ['20260918221141_department_output_tasks.sql','20260918223508_task_dashboard_deadline_buckets.sql','20260918224708_employee_deadline_confirmation.sql']){
 await db.exec(readFileSync('supabase/migrations/'+migration,'utf8'));
 console.log('PASS upstream function compatibility '+migration);
}
await db.close();
