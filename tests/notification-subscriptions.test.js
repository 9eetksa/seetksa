import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Exercise the repository's actual subscription with the installed Realtime SDK.
const source=await readFile(new URL('../src/workflow/data.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf(' subscribe:(id,refresh)=>{'),source.indexOf(' async completedBoard'));
function setup(){
 const client=createClient('https://test.supabase.co','test-key',{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  realtime:{transport:WebSocket,timeout:10},
 });
 // No network or credentials: channel lifecycle and callback registration remain real.
 client.realtime.connect=()=>{};
 const subscribe=new Function('supabase','hasImpersonation','crypto',`return ({${body}}).subscribe;`)(client,()=>false,{randomUUID});
 return {client,subscribe};
}

test('header bell and notification center can subscribe for the same user together',async()=>{
 const {client,subscribe}=setup();
 try{
  const stopBell=subscribe('user-one',()=>{});
  const stopCenter=subscribe('user-one',()=>{});
  const channels=client.getChannels();
  assert.equal(channels.length,2);
  assert.notEqual(channels[0].topic,channels[1].topic);
  for(const channel of channels){
   const filter=channel.bindings.postgres_changes[0].filter;
   assert.equal(filter.filter,'recipient=eq.user-one');
   assert.equal(filter.table,'work_notification_signals');
  }
  await stopCenter();
  assert.equal(client.getChannels().length,1);
  assert.equal(client.getChannels()[0],channels[0]);
  const stopReopened=subscribe('user-one',()=>{});
  assert.equal(client.getChannels().length,2);
  await stopReopened();await stopBell();
  assert.equal(client.getChannels().length,0);
 }finally{await client.removeAllChannels();client.realtime.disconnect();}
});

test('rapid close and reopen does not reuse a channel that is still leaving',async()=>{
 const {client,subscribe}=setup();
 try{
  const stop=subscribe('user-one',()=>{});
  const closing=stop();
  const stopNew=subscribe('user-one',()=>{});
  await closing;
  assert.equal(client.getChannels().length,1);
  await stopNew();
 }finally{await client.removeAllChannels();client.realtime.disconnect();}
});
