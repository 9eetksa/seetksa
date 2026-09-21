begin;

-- An internal portfolio library Seeded from the four existing homepage works
-- The public homepage is intentionally independent from this management library
create table public.portfolio_works (
 id uuid primary key,
 name text not null check(char_length(btrim(name)) between 1 and 150),
 description text not null check(char_length(btrim(description)) between 1 and 6000),
 project_url text check(project_url is null or (char_length(project_url)<=2048 and project_url ~ '^https?://[^[:space:]]+$')),
 status text not null default 'active' check(status in ('active','archived')),
 version integer not null default 1 check(version>0),
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.portfolio_media (
 id uuid primary key,
 work_id uuid not null references public.portfolio_works(id) on delete cascade,
 source text not null check(source in ('packaged','storage')),
 object_path text not null unique,
 filename text not null check(char_length(filename) between 1 and 300),
 mime_type text not null,
 byte_size bigint check(byte_size>=0),
 position integer not null check(position>=0),
 is_cover boolean not null default false,
 unique(work_id,position)
);
create unique index portfolio_one_cover on public.portfolio_media(work_id) where is_cover;
create index portfolio_updated on public.portfolio_works(status,updated_at desc);
alter table public.portfolio_works enable row level security;
alter table public.portfolio_media enable row level security;
revoke all on public.portfolio_works,public.portfolio_media from public,anon,authenticated;
grant select on public.portfolio_works,public.portfolio_media to authenticated;
grant all on public.portfolio_works,public.portfolio_media to service_role;
create policy portfolio_manager_read on public.portfolio_works for select to authenticated using(provision_private.work_manager());
create policy portfolio_media_manager_read on public.portfolio_media for select to authenticated using(provision_private.work_manager());

insert into public.portfolio_works(id,name,description,project_url) values
 ('7f690001-342f-4c21-a23e-000000000001','سعودي دنت','استراتيجية وهوية بصرية تعكس هوية جديدة وابتسامة لا تنسى','https://www.behance.net/gallery/237044723/Saudi-Dent-rebranding'),
 ('7f690001-342f-4c21-a23e-000000000002','ون منت','هوية بصرية لقطاع المطاعم ومذاق يبدأ من أول نظرة','https://www.behance.net/gallery/236900263/_'),
 ('7f690001-342f-4c21-a23e-000000000003','سكر','هوية بصرية لمنتجات منزلية بتفاصيل تصنع السعادة','https://www.behance.net/gallery/236900711/_'),
 ('7f690001-342f-4c21-a23e-000000000004','هدير','بناء علامة تجارية بطموح يتحرك إلى الأمام','https://www.behance.net/gallery/236900429/-(-)');
insert into public.portfolio_media(id,work_id,source,object_path,filename,mime_type,position,is_cover)
 select gen_random_uuid(),seed.id,'packaged','/portfolio/'||seed.slug||suffix.path,seed.slug||suffix.path,suffix.mime,suffix.position,suffix.position=0
 from (values
 ('7f690001-342f-4c21-a23e-000000000001'::uuid,'saudi-dent'),
 ('7f690001-342f-4c21-a23e-000000000002'::uuid,'one-minute'),
 ('7f690001-342f-4c21-a23e-000000000003'::uuid,'sukkar'),
 ('7f690001-342f-4c21-a23e-000000000004'::uuid,'hdeer')) seed(id,slug)
 cross join (values ('-portrait.webp','image/webp',0),('.jpg','image/jpeg',1)) suffix(path,mime,position);

create function provision_private.portfolio_upload(path text) returns boolean
 language sql stable security definer set search_path='' as $$
 select provision_private.work_manager()
 and path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,8}$'
 and split_part(path,'/',2)=auth.uid()::text
$$;
revoke all on function provision_private.portfolio_upload(text) from public,anon;
grant execute on function provision_private.portfolio_upload(text) to authenticated;
create policy portfolio_upload on storage.objects for insert to authenticated
 with check(bucket_id='portfolio-assets' and provision_private.portfolio_upload(name));
create policy portfolio_read on storage.objects for select to authenticated
 using(bucket_id='portfolio-assets' and provision_private.work_manager());
-- Originals stay immutable including during concurrent registration
-- Explicit server cleanup can remove unused uploads through the Storage API
-- No browser UPDATE or DELETE policies are granted for this bucket

create function public.portfolio_save(p jsonb) returns uuid
 language plpgsql security definer set search_path='' as $$
declare
 wid uuid := (p->>'id')::uuid;
 previous public.portfolio_works;
 item jsonb;
 link text := nullif(btrim(p->>'project_url'),'');
 media jsonb := p->'media';
 idx integer := 0;
 cover_count integer := 0;
begin
 if not provision_private.work_manager() then raise exception 'forbidden'; end if;
 if wid is null or octet_length(p::text)>1048576 or char_length(btrim(coalesce(p->>'name',''))) not between 1 and 150
 or char_length(btrim(coalesce(p->>'description',''))) not between 1 and 6000
 or coalesce(p->>'status','') not in ('active','archived')
 or (link is not null and (char_length(link)>2048 or link !~ '^https?://[^[:space:]]+$' or link ~ '^https?://[^/]*@'))
 or jsonb_typeof(media) is distinct from 'array' or jsonb_array_length(media)=0 then raise exception 'invalid_portfolio'; end if;
 perform pg_advisory_xact_lock(hashtextextended('portfolio:'||wid::text,0));
 select * into previous from public.portfolio_works where id=wid for update;
 if found and previous.version is distinct from (p->>'version')::integer then raise exception 'version_conflict'; end if;
 if previous.id is null and coalesce((p->>'version')::integer,0)<>0 then raise exception 'version_conflict'; end if;
 for item in select value from jsonb_array_elements(media) loop
  if nullif(item->>'id','') is null or char_length(coalesce(item->>'filename','')) not between 1 and 300 then raise exception 'invalid_portfolio_media'; end if;
  if item->>'source'='packaged' then
   if not exists(select 1 from public.portfolio_media m where m.work_id=wid and m.id=(item->>'id')::uuid and m.source='packaged' and m.object_path=item->>'object_path') then raise exception 'invalid_portfolio_media'; end if;
  elsif item->>'source'='storage' then
   if split_part(item->>'object_path','/',1)<>wid::text or item->>'mime_type' not in ('image/jpeg','image/png','image/webp','image/avif','image/gif') then raise exception 'invalid_portfolio_media'; end if;
   if not exists(select 1 from storage.objects o where o.bucket_id='portfolio-assets' and o.name=item->>'object_path'
    and o.metadata->>'mimetype'=item->>'mime_type'
    and ((o.owner_id=auth.uid()::text and provision_private.portfolio_upload(o.name))
     or exists(select 1 from public.portfolio_media m where m.work_id=wid and m.object_path=o.name and m.id=(item->>'id')::uuid))) then raise exception 'invalid_portfolio_media'; end if;
  else raise exception 'invalid_portfolio_media'; end if;
  if coalesce((item->>'is_cover')::boolean,false) then cover_count:=cover_count+1; end if;
 end loop;
 if cover_count<>1 then raise exception 'portfolio_cover_required'; end if;
 insert into public.portfolio_works(id,name,description,project_url,status,created_by,updated_by)
 values(wid,btrim(p->>'name'),btrim(p->>'description'),link,p->>'status',auth.uid(),auth.uid())
 on conflict(id) do update set name=excluded.name,description=excluded.description,project_url=excluded.project_url,status=excluded.status,
 updated_by=auth.uid(),updated_at=now(),version=portfolio_works.version+1;
 delete from public.portfolio_media where work_id=wid;
 for item in select value from jsonb_array_elements(media) loop
  insert into public.portfolio_media(id,work_id,source,object_path,filename,mime_type,byte_size,position,is_cover)
  values((item->>'id')::uuid,wid,item->>'source',item->>'object_path',item->>'filename',item->>'mime_type',nullif(item->>'byte_size','')::bigint,idx,coalesce((item->>'is_cover')::boolean,false));
  idx:=idx+1;
 end loop;
 return wid;
end;
$$;
revoke all on function public.portfolio_save(jsonb) from public,anon;
grant execute on function public.portfolio_save(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
