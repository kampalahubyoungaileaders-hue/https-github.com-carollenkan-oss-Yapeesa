-- Match private.is_officer exactly for real organisation rows: verified platform
-- administrators retain oversight reads; financial approvals still independently
-- require actual current group-officer membership through officer_eligible.
create or replace function private.officer_organisations() returns setof uuid language plpgsql stable security definer set search_path='' as $$begin
 if private.is_platform_admin() then return query select id from public.organisation;return;end if;
 if not private.session_active(true) then return;end if;
 return query select distinct m.organisation_id from public.membership m join public.person p on p.id=m.person_id where p.auth_user_id=auth.uid() and m.role in ('secretary','treasurer','chair') and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now());
end $$;
revoke all on function private.officer_organisations() from public,anon,authenticated;
grant execute on function private.officer_organisations() to authenticated;
