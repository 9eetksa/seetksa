begin;
-- Auth Admin may write trusted app_metadata after inserting the identity.
-- The initializer inserts missing staff only; it never regrants revoked rights.
drop trigger seet_initialize_account_type on auth.users;
create trigger seet_initialize_account_type after insert or update of raw_app_meta_data on auth.users
for each row execute function provision_private.seet_initialize_account_type();
commit;
