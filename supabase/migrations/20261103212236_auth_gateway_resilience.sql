-- Explicit deny policies document the private tables' closed client surface.
create policy no_client_access on private.gateway_key for all to anon,authenticated using(false) with check(false);
create policy no_client_access on private.pin_attempt for all to anon,authenticated using(false) with check(false);
-- A provider/network failure is not an incorrect PIN. Release only that reserved
-- attempt; do not erase earlier failed attempts or unlock an already locked PIN.
create function private.pin_attempt_release(p_phone text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.gateway_allowed() then raise exception 'Gateway access denied' using errcode='42501'; end if;
 update private.pin_attempt set attempts=greatest(attempts-1,0),updated_at=now() where phone=p_phone and attempts<=5;
end $$;
create function public.pin_attempt_release(p_phone text) returns void language sql security invoker set search_path='' as $$ select private.pin_attempt_release(p_phone) $$;
revoke all on function private.pin_attempt_release(text),public.pin_attempt_release(text) from public,anon,authenticated;
grant execute on function private.pin_attempt_release(text),public.pin_attempt_release(text) to anon;
