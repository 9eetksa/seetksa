begin;
create temporary table portfolio_checks(label text);
grant insert,select on portfolio_checks to authenticated;
create function pg_temp.portfolio_check(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'portfolio check failed %',label; end if;
 insert into portfolio_checks values(label);
end;
$$;

insert into auth.users(id,role,aud,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at,created_at,updated_at)
select id::uuid,'authenticated','authenticated','portfolio-'||kind||'@example.invalid',jsonb_build_object('role',kind,'portal_qa',true),'{}',now(),now(),now()
from (values
 ('fa790001-1111-4111-8111-000000000001','admin'),
 ('fa790001-1111-4111-8111-000000000002','super_admin'),
 ('fa790001-1111-4111-8111-000000000003','employee'),
 ('fa790001-1111-4111-8111-000000000004','client')
) fixture(id,kind);
insert into public.portfolio_works(id,name,description,created_by)
values('fa790002-1111-4111-8111-000000000001','Portfolio fixture','Synthetic portfolio review fixture','fa790001-1111-4111-8111-000000000001');
insert into public.portfolio_media(id,work_id,source,object_path,filename,mime_type,position,is_cover)
values('fa790003-1111-4111-8111-000000000001','fa790002-1111-4111-8111-000000000001','packaged','/portfolio/qa-fixture.jpg','fixture.jpg','image/jpeg',0,true);

select pg_temp.portfolio_check((select relrowsecurity from pg_class where oid='public.portfolio_works'::regclass),'work RLS enabled');
select pg_temp.portfolio_check((select relrowsecurity from pg_class where oid='public.portfolio_media'::regclass),'media RLS enabled');
select pg_temp.portfolio_check(not has_table_privilege('authenticated','public.portfolio_works','INSERT,UPDATE,DELETE'),'direct work writes denied');
select pg_temp.portfolio_check(not has_table_privilege('authenticated','public.portfolio_media','INSERT,UPDATE,DELETE'),'direct media writes denied');
select pg_temp.portfolio_check(not has_function_privilege('anon','public.portfolio_save(jsonb)','EXECUTE'),'anonymous save denied');
select pg_temp.portfolio_check(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and cmd in ('UPDATE','DELETE','ALL') and (coalesce(qual,'')||coalesce(with_check,'')) like '%portfolio-assets%'),'portfolio originals immutable');

set local role authenticated;
select set_config('request.jwt.claim.sub','fa790001-1111-4111-8111-000000000001',true);
select set_config('request.jwt.claims','{"sub":"fa790001-1111-4111-8111-000000000001","role":"authenticated"}',true);
do $$
declare payload jsonb; failed boolean;
begin
 perform pg_temp.portfolio_check((select count(*)=1 from public.portfolio_works where id='fa790002-1111-4111-8111-000000000001'),'admin reads work');
 perform pg_temp.portfolio_check((select count(*)=1 from public.portfolio_media where work_id='fa790002-1111-4111-8111-000000000001'),'admin reads media');
 perform pg_temp.portfolio_check(provision_private.portfolio_upload('fa790002-1111-4111-8111-000000000001/fa790001-1111-4111-8111-000000000001/fa790003-1111-4111-8111-000000000002.png'),'manager own upload path');
 perform pg_temp.portfolio_check(not provision_private.portfolio_upload('fa790002-1111-4111-8111-000000000001/fa790001-1111-4111-8111-000000000002/fa790003-1111-4111-8111-000000000002.png'),'other uploader path denied');
 select jsonb_build_object('id',w.id,'version',w.version,'name','Edited fixture','description',w.description,'project_url','https://example.invalid/work','status',w.status,'media',jsonb_agg(to_jsonb(m) order by m.position))
 into payload from public.portfolio_works w join public.portfolio_media m on m.work_id=w.id
 where w.id='fa790002-1111-4111-8111-000000000001' group by w.id;
 perform public.portfolio_save(payload);
 perform pg_temp.portfolio_check((select version=2 and name='Edited fixture' and updated_by=auth.uid() from public.portfolio_works where id='fa790002-1111-4111-8111-000000000001'),'admin atomic save and version');
 failed:=false;
 begin perform public.portfolio_save(payload); exception when others then failed:=sqlerrm='version_conflict'; end;
 perform pg_temp.portfolio_check(failed,'stale version denied');
 payload:=jsonb_set(payload,'{version}','2');
 failed:=false;
 begin perform public.portfolio_save(jsonb_set(payload,'{media}','[]')); exception when others then failed:=sqlerrm='invalid_portfolio'; end;
 perform pg_temp.portfolio_check(failed,'empty media rejected');
 failed:=false;
 begin perform public.portfolio_save(jsonb_set(payload,'{media,0,is_cover}','false')); exception when others then failed:=sqlerrm='portfolio_cover_required'; end;
 perform pg_temp.portfolio_check(failed,'cover required');
 failed:=false;
 begin perform public.portfolio_save(jsonb_set(payload,'{project_url}','"javascript:alert(1)"')); exception when others then failed:=sqlerrm='invalid_portfolio'; end;
 perform pg_temp.portfolio_check(failed,'unsafe project protocol denied');
 failed:=false;
 begin perform public.portfolio_save(jsonb_set(payload,'{project_url}','"https://user:pass@example.invalid/work"')); exception when others then failed:=sqlerrm='invalid_portfolio'; end;
 perform pg_temp.portfolio_check(failed,'credential project URL denied');
 failed:=false;
 begin perform public.portfolio_save(jsonb_set(payload,'{media,0,object_path}','"/portfolio/other.jpg"')); exception when others then failed:=sqlerrm='invalid_portfolio_media'; end;
 perform pg_temp.portfolio_check(failed,'unseeded packaged path denied');
 failed:=false;
 begin perform public.portfolio_save(jsonb_set(payload,'{media}',jsonb_build_array(jsonb_build_object('id','fa790003-1111-4111-8111-000000000002','source','storage','object_path','fa790002-1111-4111-8111-000000000001/fa790001-1111-4111-8111-000000000001/fa790003-1111-4111-8111-000000000002.png','filename','missing.png','mime_type','image/png','is_cover',true))));
 exception when others then failed:=sqlerrm='invalid_portfolio_media'; end;
 perform pg_temp.portfolio_check(failed,'unuploaded storage path denied');
 perform pg_temp.portfolio_check((select version=2 from public.portfolio_works where id='fa790002-1111-4111-8111-000000000001'),'failed saves preserve version');
 perform pg_temp.portfolio_check((select count(*)=1 from public.portfolio_media where work_id='fa790002-1111-4111-8111-000000000001'),'failed saves preserve media');
end;
$$;

select set_config('request.jwt.claim.sub','fa790001-1111-4111-8111-000000000002',true);
select set_config('request.jwt.claims','{"sub":"fa790001-1111-4111-8111-000000000002","role":"authenticated"}',true);
do $$
declare payload jsonb;
begin
 select jsonb_build_object('id',w.id,'version',w.version,'name',w.name,'description',w.description,'project_url',w.project_url,'status','archived','media',jsonb_agg(to_jsonb(m) order by m.position))
 into payload from public.portfolio_works w join public.portfolio_media m on m.work_id=w.id
 where w.id='fa790002-1111-4111-8111-000000000001' group by w.id;
 perform public.portfolio_save(payload);
 perform pg_temp.portfolio_check((select version=3 and status='archived' and updated_by=auth.uid() from public.portfolio_works where id='fa790002-1111-4111-8111-000000000001'),'super admin can archive shared library');
end;
$$;

select set_config('request.jwt.claim.sub','fa790001-1111-4111-8111-000000000003',true);
select set_config('request.jwt.claims','{"sub":"fa790001-1111-4111-8111-000000000003","role":"authenticated"}',true);
do $$
declare denied boolean:=false;
begin
 perform pg_temp.portfolio_check(not exists(select 1 from public.portfolio_works),'employee cannot read works');
 perform pg_temp.portfolio_check(not exists(select 1 from public.portfolio_media),'employee cannot read media');
 perform pg_temp.portfolio_check(not provision_private.portfolio_upload('fa790002-1111-4111-8111-000000000001/fa790001-1111-4111-8111-000000000003/fa790003-1111-4111-8111-000000000002.png'),'employee upload denied');
 begin perform public.portfolio_save('{}'); exception when others then denied:=sqlerrm='forbidden'; end;
 perform pg_temp.portfolio_check(denied,'employee save denied');
end;
$$;

select set_config('request.jwt.claim.sub','fa790001-1111-4111-8111-000000000004',true);
select set_config('request.jwt.claims','{"sub":"fa790001-1111-4111-8111-000000000004","role":"authenticated"}',true);
do $$
declare denied boolean:=false;
begin
 perform pg_temp.portfolio_check(not exists(select 1 from public.portfolio_works),'client cannot read works');
 perform pg_temp.portfolio_check(not exists(select 1 from public.portfolio_media),'client cannot read media');
 perform pg_temp.portfolio_check(not provision_private.portfolio_upload('fa790002-1111-4111-8111-000000000001/fa790001-1111-4111-8111-000000000004/fa790003-1111-4111-8111-000000000002.png'),'client upload denied');
 begin perform public.portfolio_save('{}'); exception when others then denied:=sqlerrm='forbidden'; end;
 perform pg_temp.portfolio_check(denied,'client save denied');
end;
$$;
reset role;
select count(*) as passed_checks from portfolio_checks;
rollback;
