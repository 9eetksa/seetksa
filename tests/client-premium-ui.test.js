import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workspace=readFileSync(new URL('../src/workflow/ClientWorkspace.jsx',import.meta.url),'utf8');
const form=readFileSync(new URL('../src/workflow/ClientRequestForm.jsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('../src/workflow/client-workspace.css',import.meta.url),'utf8');
const timeline=readFileSync(new URL('../src/workflow/client-request-timeline.css',import.meta.url),'utf8');
const preview=readFileSync(new URL('../src/workflow/attachment-preview.css',import.meta.url),'utf8');

test('client dashboard exposes connected summary filters and resets search when switching scope',()=>{
 assert.match(workspace,/className="c-metrics"/);
 assert.match(workspace,/count:board\.counts\.ready/);
 assert.match(workspace,/onClick=\{\(\)=>selectProjectScope\(id\)\}/);
 assert.match(workspace,/metrics\.map\(\(\{id,title,hint,Icon,count\}\)/);
 assert.match(workspace,/numberFormatter\.format\(Number\(count\)\|\|0\)/);
 assert.match(workspace,/function selectProjectScope\(id\)\{setSelected\(null\);setPage\(0\);setSearch\(''\)/);
});

test('client project rows communicate the next action',()=>{
 assert.match(workspace,/const projectNext=/);
 assert.match(workspace,/التسليم جاهز وينتظر قرارك/);
 assert.match(workspace,/الفريق ينتظر معلوماتك/);
 assert.match(workspace,/className="c-project-open"/);
});

test('client request form is grouped into three clear sections',()=>{
 assert.match(form,/request-brief-title/);
 assert.match(form,/request-schedule-title/);
 assert.match(form,/request-files-title/);
 assert.match(form,/c-dialog-actions/);
});

test('accent surfaces use the computed readable foreground',()=>{
 assert.match(styles,/\.c-root \.c-primary\{color:var\(--s-action-text/);
 assert.match(timeline,/color:var\(--s-action-text/);
 assert.match(preview,/color: var\(--s-action-text/);
});
