-- Explicit client denial for the server's execution-device configuration.
create policy identity_service_client_denied on private.identity_service for select to authenticated using(false);
-- Lost-authenticator recovery changes identity factors, never financial records.
do $$begin if not exists(select 1 from pg_roles where rolname='yapesa_recovery') then create role yapesa_recovery nologin noinherit nobypassrls;end if;end $$;
grant yapesa_recovery to postgres;
create table private.mfa_recovery(
 id uuid primary key default gen_random_uuid(),person_id uuid not null references public.person(id),auth_user_id uuid not null,
 factor_ids uuid[] not null check(cardinality(factor_ids)>0),reason text not null check(length(reason) between 1 and 500 and reason ~ '[^[:space:]]'),recorded_at timestamptz not null default now()
);
create table private.mfa_recovery_approval(
 recovery_id uuid not null references private.mfa_recovery(id),actor_id uuid not null references public.person(id),
 identity_evidence text not null check(length(identity_evidence) between 1 and 500 and identity_evidence ~ '[^[:space:]]'),recorded_at timestamptz not null default now(),primary key(recovery_id,actor_id)
);
create table private.mfa_recovery_event(
 recovery_id uuid not null references private.mfa_recovery(id),phase text not null check(phase in ('prepared','reset','recovered')),actor_id uuid not null references public.person(id),recorded_at timestamptz not null default now(),primary key(recovery_id,phase)
);
create index on private.mfa_recovery(person_id,recorded_at desc);
create index on private.mfa_recovery(auth_user_id);
create index on private.mfa_recovery_approval(actor_id);
create index on private.mfa_recovery_event(actor_id);
do $$declare tbl text;begin foreach tbl in array array['mfa_recovery','mfa_recovery_approval','mfa_recovery_event'] loop
 execute format('alter table private.%I enable row level security',tbl);
 execute format('revoke all on private.%I from public,anon,authenticated',tbl);
 execute format('grant select,insert on private.%I to yapesa_recovery',tbl);
 execute format('create policy recovery_access on private.%I for all to yapesa_recovery using(private.session_active(false)) with check(private.session_active(false))',tbl);
 execute format('create trigger immutable_record before update or delete on private.%I for each row execute function private.immutable_record()',tbl);
 end loop;end $$;
grant usage on schema public,private,auth to yapesa_recovery;
grant execute on function private.is_platform_admin(),private.current_person(),private.session_active(boolean),private.identity_admin_eligible(uuid),private.identity_gateway(),private.identity_begin(uuid,jsonb) to yapesa_recovery;
grant select,insert on private.identity_receipt to yapesa_recovery;
create policy recovery_receipt on private.identity_receipt for all to yapesa_recovery using(private.session_active(false)) with check(private.session_active(false));
grant select on public.person to yapesa_recovery;
create policy recovery_person_read on public.person for select to yapesa_recovery using(private.session_active(false) and (id=private.current_person() or private.is_platform_admin()));



-- A reset locks every financial AAL2 session until a fresh SMS + new TOTP proof.
-- This helper intentionally reads the real Auth user ID without session_active,
-- because session_active(true) calls it. No auth secrets are returned.
create function private.recovery_blocked() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from private.mfa_recovery r where r.auth_user_id=auth.uid() and exists(select 1 from private.mfa_recovery_event e where e.recovery_id=r.id and e.phase='prepared') and not exists(select 1 from private.mfa_recovery_event e where e.recovery_id=r.id and e.phase='recovered'));
$$;
revoke all on function private.recovery_blocked() from public,anon,authenticated;
create or replace function private.session_active(p_mfa boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from auth.sessions s where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now())
 and (not p_mfa or ((auth.jwt()->>'aal')='aal2' and s.aal::text='aal2' and exists(select 1 from auth.mfa_factors f where f.id=s.factor_id and f.user_id=s.user_id and f.status::text='verified') and not private.recovery_blocked())));
$$;

create or replace function private.requires_mfa() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and ((select private.recovery_blocked()) or exists(select 1 from public.membership m join public.person p on p.id=m.person_id where p.auth_user_id=auth.uid() and m.role<>'member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())));
$$;

create function private.recovery_snapshot(p_person uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid;verified integer;ids uuid[];begin
 if not private.session_active(false) or (p_person is distinct from private.current_person() and not private.is_platform_admin()) then raise exception 'Not permitted' using errcode='42501';end if;
 select p.auth_user_id into u from public.person p join auth.users a on a.id=p.auth_user_id where p.id=p_person and a.phone_confirmed_at is not null;
 if u is null then raise exception 'Verified phone identity required' using errcode='42501';end if;
 if exists(select 1 from auth.mfa_factors where user_id=u and factor_type::text<>'totp') then raise exception 'Unsupported factor requires project-owner review' using errcode='22023';end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]),count(*) filter(where status::text='verified') into ids,verified from auth.mfa_factors where user_id=u;
 return jsonb_build_object('auth_user_id',u,'factor_ids',to_jsonb(ids),'verified_count',verified);
end $$;
create function private.recovery_admin_eligible(p_person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.session_active(false) and private.identity_admin_eligible(p_person) and not exists(select 1 from private.mfa_recovery r where r.person_id=p_person and exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase='prepared') and not exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase='recovered'));
$$;
create function private.recovery_fresh_session(p_case uuid,p_require_mfa boolean) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from private.mfa_recovery r join private.mfa_recovery_event e on e.recovery_id=r.id and e.phase='reset' join auth.sessions s on s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=r.auth_user_id
 where r.id=p_case and r.auth_user_id=auth.uid() and s.created_at>e.recorded_at and (s.not_after is null or s.not_after>now())
 and (auth.jwt()->'amr') @> '[{"method":"otp"}]'::jsonb
 and (not p_require_mfa or ((auth.jwt()->>'aal')='aal2' and s.aal::text='aal2' and exists(select 1 from auth.mfa_factors f where f.id=s.factor_id and f.user_id=s.user_id and f.status::text='verified' and f.factor_type::text='totp' and not(f.id=any(r.factor_ids))))));
$$;
revoke all on function private.recovery_snapshot(uuid),private.recovery_admin_eligible(uuid),private.recovery_fresh_session(uuid,boolean) from public,anon,authenticated;
grant execute on function private.recovery_snapshot(uuid),private.recovery_admin_eligible(uuid),private.recovery_fresh_session(uuid,boolean) to yapesa_recovery;

create function private.mfa_recovery_request(p_request uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;payload jsonb;prior jsonb;snapshot jsonb;ids uuid[];id uuid:=gen_random_uuid();result jsonb;begin
 if not private.identity_gateway() then raise exception 'Verified SMS gateway required' using errcode='42501';end if;
 actor:=private.current_person();if actor is null then raise exception 'Verified linked identity required' using errcode='42501';end if;
 payload:=jsonb_build_object('action','mfa_recovery_request','reason',p_reason);prior:=private.identity_begin(p_request,payload);if prior is not null then return prior;end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,21));
 if p_reason is null or length(p_reason) not between 1 and 500 or p_reason !~ '[^[:space:]]' then raise exception 'Reason required' using errcode='22023';end if;
 select r.id into id from private.mfa_recovery r where r.person_id=actor and not exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase='recovered') order by r.recorded_at desc limit 1;
 if found then
  result:=jsonb_build_object('id',id);
  insert into private.identity_receipt(request_id,actor_id,payload,result) values(p_request,actor,payload,result);
  return result;
 end if;
 id:=gen_random_uuid();
 snapshot:=private.recovery_snapshot(actor);
 if (snapshot->>'verified_count')::integer<1 then raise exception 'Existing verified authenticator required' using errcode='22023';end if;
 select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(snapshot->'factor_ids');
 insert into private.mfa_recovery(id,person_id,auth_user_id,factor_ids,reason) values(id,actor,(snapshot->>'auth_user_id')::uuid,ids,p_reason);
 result:=jsonb_build_object('id',id);
 insert into private.identity_receipt(request_id,actor_id,payload,result) values(p_request,actor,payload,result);
 return result;
end $$;
create function private.mfa_recovery_approve(p_request uuid,p_case uuid,p_evidence text,p_verified boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.mfa_recovery;actor uuid;payload jsonb;prior jsonb;snapshot jsonb;result jsonb;begin
 if not private.is_platform_admin() then raise exception 'Verified administrator required' using errcode='42501';end if;
 actor:=private.current_person();payload:=jsonb_build_object('action','mfa_recovery_approve','case',p_case,'evidence',p_evidence,'verified',p_verified);prior:=private.identity_begin(p_request,payload);if prior is not null then return prior;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_case::text,22));select * into strict r from private.mfa_recovery where id=p_case;
 if actor=r.person_id or p_verified is distinct from true or p_evidence is null or length(p_evidence) not between 1 and 500 or p_evidence !~ '[^[:space:]]' then raise exception 'Separate administrator and recorded identity verification required' using errcode='42501';end if;
 if exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase in ('prepared','reset','recovered')) then raise exception 'Reset already prepared' using errcode='22023';end if;
 snapshot:=private.recovery_snapshot(r.person_id);
 if snapshot->'factor_ids'<>to_jsonb(r.factor_ids) then raise exception 'Authenticator changed; request needs project-owner review' using errcode='22023';end if;
 insert into private.mfa_recovery_approval(recovery_id,actor_id,identity_evidence) values(r.id,actor,p_evidence);
 result:=jsonb_build_object('id',r.id);insert into private.identity_receipt(request_id,actor_id,payload,result) values(p_request,actor,payload,result);
 return result;
end $$;

create function private.mfa_reset_context(p_case uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r private.mfa_recovery;snapshot jsonb;ids uuid[];begin
 if not private.is_platform_admin() then raise exception 'Verified administrator required' using errcode='42501';end if;
 select * into strict r from private.mfa_recovery where id=p_case;
 if r.person_id=private.current_person() or (select count(*) from private.mfa_recovery_approval a where a.recovery_id=r.id and a.actor_id<>r.person_id and private.recovery_admin_eligible(a.actor_id))<2 then raise exception 'Two current separate verified administrators required' using errcode='42501';end if;
 if not exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase='prepared') then raise exception 'Prepared job required' using errcode='42501';end if;
 snapshot:=private.recovery_snapshot(r.person_id);select coalesce(array_agg(value::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(snapshot->'factor_ids');
 if (snapshot->>'auth_user_id')::uuid<>r.auth_user_id or not(ids<@r.factor_ids) then raise exception 'Identity or authenticator changed' using errcode='22023';end if;
 return jsonb_build_object('id',r.id,'auth_user_id',r.auth_user_id,'factor_ids',to_jsonb(r.factor_ids),'done',exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase='reset'));
end $$;
create function private.mfa_reset_job(p_case uuid,p_finish boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.mfa_recovery;context jsonb;snapshot jsonb;begin
 if not private.is_platform_admin() or not private.identity_gateway() or p_finish is null then raise exception 'Verified administrator gateway required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_case::text,22));select * into strict r from private.mfa_recovery where id=p_case;
 if not exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase='prepared') then
  snapshot:=private.recovery_snapshot(r.person_id);if snapshot->'factor_ids'<>to_jsonb(r.factor_ids) then raise exception 'Authenticator changed' using errcode='22023';end if;
  insert into private.mfa_recovery_event(recovery_id,phase,actor_id) values(r.id,'prepared',private.current_person());
 end if;
 context:=private.mfa_reset_context(r.id);
 if context->>'done'='true' then return context;end if;
 if p_finish then
  snapshot:=private.recovery_snapshot(r.person_id);if jsonb_array_length(snapshot->'factor_ids')<>0 then raise exception 'Auth factor removal not confirmed' using errcode='22023';end if;
  insert into private.mfa_recovery_event(recovery_id,phase,actor_id) values(r.id,'reset',private.current_person());
 end if;
 return jsonb_build_object('id',r.id,'done',p_finish);
end $$;
create function private.mfa_recovery_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r private.mfa_recovery;begin
 if not private.session_active(false) then raise exception 'Verified identity required' using errcode='42501';end if;
 select * into r from private.mfa_recovery where person_id=private.current_person() and not exists(select 1 from private.mfa_recovery_event where recovery_id=id and phase='recovered') order by recorded_at desc limit 1;
 return jsonb_build_object('id',r.id,'can_enroll',coalesce(private.recovery_fresh_session(r.id,false),false),'reset',exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase='reset'));
end $$;
create function private.mfa_recovery_finish() returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.mfa_recovery;begin
 if not private.identity_gateway() then raise exception 'Verified recovery gateway required' using errcode='42501';end if;
 select * into strict r from private.mfa_recovery where person_id=private.current_person() order by recorded_at desc limit 1;
 perform pg_advisory_xact_lock(hashtextextended(r.id::text,22));
 if not private.recovery_fresh_session(r.id,true) then raise exception 'Fresh SMS and new authenticator verification required' using errcode='42501';end if;
 if exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase='recovered') then return jsonb_build_object('id',r.id);end if;
 insert into private.mfa_recovery_event(recovery_id,phase,actor_id) values(r.id,'recovered',r.person_id);
 return jsonb_build_object('id',r.id);
end $$;
create function private.mfa_recovery_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not private.is_platform_admin() then raise exception 'Verified administrator required' using errcode='42501';end if;
 return jsonb_build_object('cases',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'person_id',r.person_id,'name',p.display_name,'phone',p.phone,'reason',r.reason,'recorded_at',r.recorded_at,'approvals',coalesce((select jsonb_agg(jsonb_build_object('actor_id',a.actor_id,'evidence',a.identity_evidence,'eligible',private.recovery_admin_eligible(a.actor_id)) order by a.recorded_at,a.actor_id) from private.mfa_recovery_approval a where a.recovery_id=r.id),'[]'::jsonb),'prepared',exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase='prepared'),'reset',exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase='reset'),'recovered',exists(select 1 from private.mfa_recovery_event where recovery_id=r.id and phase='recovered')) order by r.recorded_at desc,r.id) from private.mfa_recovery r join public.person p on p.id=r.person_id),'[]'::jsonb));
end $$;
-- Scoped executors cannot write Auth tables or financial journals.
grant create on schema private to yapesa_recovery;
do $$declare signature text;begin foreach signature in array array['mfa_recovery_request(uuid,text)','mfa_recovery_approve(uuid,uuid,text,boolean)','mfa_reset_context(uuid)','mfa_reset_job(uuid,boolean)','mfa_recovery_state()','mfa_recovery_finish()','mfa_recovery_workspace()'] loop
 execute format('alter function private.%s owner to yapesa_recovery',signature);execute format('revoke all on function private.%s from public,anon,authenticated',signature);execute format('grant execute on function private.%s to authenticated',signature);end loop;end $$;
revoke create on schema private from yapesa_recovery;
create function public.mfa_recovery_request(p_request uuid,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select private.mfa_recovery_request(p_request,p_reason);$$;
create function public.mfa_recovery_approve(p_request uuid,p_case uuid,p_evidence text,p_verified boolean) returns jsonb language sql security invoker set search_path='' as $$select private.mfa_recovery_approve(p_request,p_case,p_evidence,p_verified);$$;
create function public.mfa_reset_context(p_case uuid) returns jsonb language sql security invoker set search_path='' as $$select private.mfa_reset_context(p_case);$$;
create function public.mfa_reset_job(p_case uuid,p_finish boolean) returns jsonb language sql security invoker set search_path='' as $$select private.mfa_reset_job(p_case,p_finish);$$;
create function public.mfa_recovery_state() returns jsonb language sql security invoker set search_path='' as $$select private.mfa_recovery_state();$$;
create function public.mfa_recovery_finish() returns jsonb language sql security invoker set search_path='' as $$select private.mfa_recovery_finish();$$;
create function public.mfa_recovery_workspace() returns jsonb language sql security invoker set search_path='' as $$select private.mfa_recovery_workspace();$$;
revoke all on function public.mfa_recovery_request(uuid,text),public.mfa_recovery_approve(uuid,uuid,text,boolean),public.mfa_reset_context(uuid),public.mfa_reset_job(uuid,boolean),public.mfa_recovery_state(),public.mfa_recovery_finish(),public.mfa_recovery_workspace() from public,anon,authenticated;
grant execute on function public.mfa_recovery_request(uuid,text),public.mfa_recovery_approve(uuid,uuid,text,boolean),public.mfa_reset_context(uuid),public.mfa_reset_job(uuid,boolean),public.mfa_recovery_state(),public.mfa_recovery_finish(),public.mfa_recovery_workspace() to authenticated;

-- The set depends on the current real session, MFA/recovery state and live roles.
-- The policy subquery evaluates it once per SQL statement, avoiding repeated
-- linked-transaction permission lookups for every officer journal line.
create function private.officer_organisations() returns setof uuid language sql stable security definer set search_path='' as $$
 select distinct m.organisation_id from public.membership m join public.person p on p.id=m.person_id
 where private.session_active(true) and p.auth_user_id=auth.uid() and m.role in ('secretary','treasurer','chair') and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now());
$$;
revoke all on function private.officer_organisations() from public,anon,authenticated;
grant execute on function private.officer_organisations() to authenticated;
alter policy journal_read on public.journal using(case when organisation_id in(select private.officer_organisations()) then true else private.can_read_journal(id) end);
alter policy line_read on public.journal_line using(case when organisation_id in(select private.officer_organisations()) then true else private.can_read_journal(journal_id) end);

-- The existing can_read_org predicate, expressed as one actor-bound set for RLS
-- joins. Metadata scope and member ownership rules are unchanged.
create function private.readable_organisations() returns setof uuid language plpgsql stable security definer set search_path='' as $$begin
 if private.is_platform_admin() then return query select id from public.organisation;return;end if;
 if not private.session_active(private.requires_mfa()) then return;end if;
 return query select distinct m.organisation_id from public.membership m join public.person p on p.id=m.person_id where p.auth_user_id=auth.uid() and m.role in ('member','secretary','treasurer','chair') and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now());
end $$;
revoke all on function private.readable_organisations() from public,anon,authenticated;
grant execute on function private.readable_organisations() to authenticated;
alter policy organisation_read on public.organisation using(id in(select private.readable_organisations()));
alter policy settings_read on public.group_settings using(organisation_id in(select private.readable_organisations()));
alter policy cycle_read on public.cycle using(organisation_id in(select private.readable_organisations()));
alter policy meeting_read on public.meeting using(organisation_id in(select private.readable_organisations()));
alter policy account_read on public.ledger_account using(organisation_id in(select private.readable_organisations()));
alter policy membership_read on public.membership using(person_id=(select private.current_person()) or organisation_id in(select private.officer_organisations()));
alter policy txn_read on public.group_txn using(organisation_id in(select private.readable_organisations()) and (member_id=(select private.current_person()) or organisation_id in(select private.officer_organisations())));
alter policy device_read on public.device using(organisation_id in(select private.officer_organisations()));
alter policy receipt_read on public.sync_receipt using(organisation_id in(select private.officer_organisations()));
alter policy audit_read on public.audit_log using(organisation_id in(select private.officer_organisations()));
