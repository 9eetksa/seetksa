import assert from 'node:assert/strict';

// Auth-row and RPC coverage in the isolated PostgreSQL harness, with no live users.
export async function testSeetPhoneAccounts(db) {
 const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const owner=id(5), employee=id(910001), collaborator=id(910002), supervisor=id(910003), malicious=id(910004);
 const actor=async user=>{
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:user===owner?id(105):id(Number(user.slice(-12))+1000000),role:'authenticated'})]);
  await db.exec('set role authenticated');
 };
 const context=async()=>(await q('select public.seet_mission_context() as value'))[0].value;
 const action=async(name,p)=>(await q('select public.seet_mission_action($1,$2) as value',[name,JSON.stringify(p)]))[0].value;
 const directory=async type=>(await q('select public.platform_account_directory($1,$2) as value',['+966589910',type]))[0].value;
 await db.exec('reset role');
 const internalIdentifier='phone-fixture@accounts.seet.invalid';
 for(const [user,type,email] of [[employee,'employee',null],[collaborator,'collaborator',internalIdentifier],[supervisor,'supervisor',''],[malicious,'employee',null]]) {
  await q('insert into auth.users(id,email,phone,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4,$5)',[user,email,`+966589${user.slice(-6)}`,JSON.stringify({role:'employee',account_type:type,phone_only:true}),JSON.stringify(user===malicious?{account_type:'supervisor',role:'super_admin',operations_manager:true}:{display_name:`Phone account ${type}`})]);
  await q('insert into auth.sessions(id,user_id) values($1,$2)',[id(Number(user.slice(-12))+1000000),user]);
 }
 const staffRows=await q('select user_id,employment_type,operations_manager from public.work_staff where user_id=any($1::uuid[])',[[employee,collaborator,supervisor,malicious]]);
 assert.equal(staffRows.length,4);
 for(const user of [employee,malicious]) assert.deepEqual(staffRows.find(row=>row.user_id===user),{user_id:user,employment_type:'regular',operations_manager:false});
 assert.deepEqual(staffRows.find(row=>row.user_id===collaborator),{user_id:collaborator,employment_type:'freelancer',operations_manager:false});
 assert.deepEqual(staffRows.find(row=>row.user_id===supervisor),{user_id:supervisor,employment_type:'regular',operations_manager:true});
 const authRows=await q("select id,email,raw_app_meta_data->>'role' as role from auth.users where id=any($1::uuid[])",[[employee,collaborator,supervisor,malicious]]);
 assert(authRows.every(row=>row.role==='employee'),'phone-only account types retain the employee authorization role');
 assert.equal(authRows.find(row=>row.id===collaborator).email,internalIdentifier,'Auth retains the internal phone routing identifier');
 assert(authRows.filter(row=>row.id!==collaborator).every(row=>!row.email),'accounts with blank Auth email remain supported');
 await actor(owner);
 const all=(await directory('all')).items;
 assert.equal(all.length,4);
 for(const [user,type] of [[employee,'employee'],[collaborator,'collaborator'],[supervisor,'supervisor'],[malicious,'employee']]) {
  const row=all.find(item=>item.id===user);assert.equal(row.account_type,type);assert.equal(row.role,'employee');assert.equal(row.phone_only,true);assert(!row.email);
  const profile=(await q('select public.work_employee_profile($1) as value',[user]))[0].value;
  assert.equal(profile.email,'','employee edit never exposes phone-only routing identifiers');
  assert.equal(profile.employment_type,user===collaborator?'freelancer':'regular');
 }
 assert.equal((await q('select public.platform_account_brief($1) as value',[collaborator]))[0].value.account.email,'','account brief reuses safe directory projection');
 assert.deepEqual((await directory('employee')).items.map(row=>row.id).sort(),[employee,malicious].sort());
 assert.deepEqual((await directory('collaborator')).items.map(row=>row.id),[collaborator]);
 assert.deepEqual((await directory('supervisor')).items.map(row=>row.id),[supervisor]);
 await actor(malicious);assert.equal((await context()).operations,false);
 await assert.rejects(action('set_operations',{user_id:malicious,enabled:true}),/forbidden/);
 await assert.rejects(q('select public.platform_account_directory()'),/forbidden/);
 await actor(supervisor);assert.equal((await context()).operations,true);
 await q("select public.seet_mission_board('operations')");
 await actor(owner);await action('set_operations',{user_id:supervisor,enabled:false});
 assert.equal((await directory('supervisor')).items.length,0,'directory follows current grants, not stale account_type metadata');
 assert((await directory('employee')).items.some(row=>row.id===supervisor));
 await actor(supervisor);assert.equal((await context()).operations,false);
 await assert.rejects(q("select public.seet_mission_board('operations')"),/forbidden/);

 await db.exec('reset role');
 await q("update public.work_staff set employment_type='freelancer',coordinator=true,capacity=7 where user_id=$1",[supervisor]);
 await q("insert into public.account_profiles(user_id,display_name,phone) values($1,'Preserved staff profile',$2) on conflict(user_id) do update set display_name=excluded.display_name,phone=excluded.phone",[supervisor,'+966589910003']);
 const staffBefore=(await q('select * from public.work_staff where user_id=$1',[supervisor]))[0];
 const profileBefore=(await q('select * from public.account_profiles where user_id=$1',[supervisor]))[0];
 await q("update auth.users set last_sign_in_at=now(),raw_app_meta_data=raw_app_meta_data||'{\"phone_only\":true}',raw_user_meta_data=raw_user_meta_data||'{\"account_type\":\"supervisor\",\"operations_manager\":true}' where id=$1",[supervisor]);
 assert.deepEqual((await q('select * from public.work_staff where user_id=$1',[supervisor]))[0],staffBefore,'Auth updates do not reinitialize or restore grants');
 assert.deepEqual((await q('select * from public.account_profiles where user_id=$1',[supervisor]))[0],profileBefore,'Auth updates preserve authored staff profile');
 await actor(owner);
 assert((await directory('collaborator')).items.some(row=>row.id===supervisor),'directory employment type follows work_staff overrides');
 await actor(supervisor);assert.equal((await context()).operations,false);
 await db.exec('reset role');
 const delayedSupervisor=id(910005);
 await q("insert into auth.users(id,phone,raw_app_meta_data) values($1,'+966589910005','{}')",[delayedSupervisor]);
 assert.equal((await q('select user_id from public.work_staff where user_id=$1',[delayedSupervisor])).length,0,'Auth identity can precede its trusted account metadata');
 await q("update auth.users set raw_app_meta_data='{\"role\":\"employee\",\"account_type\":\"supervisor\",\"phone_only\":true}' where id=$1",[delayedSupervisor]);
 assert.deepEqual((await q('select employment_type,operations_manager from public.work_staff where user_id=$1',[delayedSupervisor]))[0],{employment_type:'regular',operations_manager:true},'delayed Auth Admin metadata initializes missing supervisor staff');
 console.log('PASS phone-only account initialization directory type filters trusted metadata operations revocation and Auth update preservation');
}
