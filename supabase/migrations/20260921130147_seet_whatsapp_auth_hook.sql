begin;
create extension if not exists supabase_vault with schema vault;
create or replace function public.seet_configure_whatsapp(p_token text) returns void
language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
 if p_token is null or length(p_token) not between 20 and 512 or p_token !~ '^[A-Za-z0-9_-]+$' then raise exception 'invalid_provider_token'; end if;
 select id into secret_id from vault.secrets where name='seet_green_api_token';
 if secret_id is null then
  perform vault.create_secret(p_token,'seet_green_api_token','Seet WhatsApp authentication');
 else perform vault.update_secret(secret_id,p_token); end if;
end $$;
revoke all on function public.seet_configure_whatsapp(text) from public,anon,authenticated;
grant execute on function public.seet_configure_whatsapp(text) to service_role;

create function public.seet_send_whatsapp_otp(event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_token text; v_phone text; v_otp text; target_user uuid;
begin
 target_user=(event->'user'->>'id')::uuid;
 v_phone=ltrim(event->'user'->>'phone','+');
 v_otp=event->'sms'->>'otp';
 if v_phone is null or v_phone !~ '^[1-9][0-9]{7,14}$' or v_otp is null or v_otp !~ '^[0-9]{6}$'
  or not exists(select 1 from auth.users u where u.id=target_user and ltrim(u.phone,'+')=v_phone
   and u.raw_app_meta_data->>'role' in ('super_admin','admin','employee')
   and not coalesce(u.is_anonymous,false) and provision_private.account_available(u.id)) then
  return '{"error":{"http_code":403,"message":"Account unavailable"}}'::jsonb;
 end if;
 select decrypted_secret into v_token from vault.decrypted_secrets where name='seet_green_api_token';
 if nullif(v_token,'') is null then
  return '{"error":{"http_code":503,"message":"WhatsApp is not configured"}}'::jsonb;
 end if;
 perform net.http_post(
  url:='https://7107.api.greenapi.com/waInstance710722692511/sendMessage/'||v_token,
  headers:='{"Content-Type":"application/json"}'::jsonb,
  body:=jsonb_build_object('chatId',v_phone||'@c.us','message','رمز التحقق للدخول إلى صيت: '||v_otp||E'\nصالح لمدة 5 دقائق ولا تشاركه مع أي شخص','linkPreview',false),
  timeout_milliseconds:=10000);
 return '{}'::jsonb;
exception when others then
 -- Never return HTTP URLs, OTP values or decrypted secrets in errors.
 return '{"error":{"http_code":503,"message":"WhatsApp request could not be queued"}}'::jsonb;
end $$;
revoke all on function public.seet_send_whatsapp_otp(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.seet_send_whatsapp_otp(jsonb) to supabase_auth_admin;
revoke all on net.http_request_queue,net._http_response from anon,authenticated;
notify pgrst,'reload schema';
commit;
