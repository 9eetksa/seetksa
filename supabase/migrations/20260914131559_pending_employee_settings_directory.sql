-- Management preparation includes pending accounts while operational directories
-- continue to require completed onboarding
create function public.work_settings_staff()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(provision_private.is_owner(),false) then
  raise exception 'forbidden' using errcode='42501';
 end if;
 return (
  select coalesce(jsonb_agg(to_jsonb(person) order by person.name,person.id),'[]'::jsonb)
  from (
   select account.id,
    coalesce(nullif(btrim(profile.display_name),''),nullif(btrim(account.raw_user_meta_data->>'display_name'),''),account.email) as name,
    account.raw_app_meta_data->>'role' as role,
    coalesce(account.raw_app_meta_data->>'must_change_password','false')='true' as pending_setup,
    coalesce(staff.capacity,5) as capacity,
    coalesce(staff.coordinator,false) as coordinator,
    (select count(*) from public.work_parts part where part.assignee_id=account.id
     and part.status not in('approved','forwarded','internal_done')) as open_count
   from auth.users account
   left join public.account_profiles profile on profile.user_id=account.id
   left join public.work_staff staff on staff.user_id=account.id
   where account.raw_app_meta_data->>'role' in('employee','admin')
    and not coalesce(account.is_anonymous,false)
    and provision_private.account_available(account.id)
  ) person
 );
end;
$$;
revoke all on function public.work_settings_staff() from public,anon,authenticated;
grant execute on function public.work_settings_staff() to authenticated;
notify pgrst,'reload schema';
