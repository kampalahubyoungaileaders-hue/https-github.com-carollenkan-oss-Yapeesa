-- Staff account jobs never grant financial authority before phone + TOTP proof.
do $$begin if not exists(select 1 from pg_roles where rolname='yapesa_identity') then create role yapesa_identity nologin noinherit nobypassrls;end if;end $$;
grant yapesa_identity to postgres;
-- Identity jobs run on the server; this is their service device, not a group's writer device.
create table private.identity_service(id boolean primary key default true check(id),device_id uuid not null unique default gen_random_uuid());
insert into private.identity_service(id) values(true);
alter table private.identity_service enable row level security;
revoke all on private.identity_service from public,anon,authenticated;
create function private.identity_service_device() returns uuid language sql stable security definer set search_path='' as $$select device_id from private.identity_service where id=true and private.session_active(false);$$;
revoke all on function private.identity_service_device() from public,anon,authenticated;
grant execute on function private.identity_service_device() to yapesa_identity;
create table private.staff_invitation(
 id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisation(id),person_id uuid not null references public.person(id),
 role text not null check(role in ('secretary','treasurer','chair')),phone text not null check(phone ~ '^\+[1-9][0-9]{6,14}$'),
 email text not null check(length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
 reason text not null check(length(reason) between 1 and 500 and reason ~ '[^[:space:]]'),created_by uuid not null references public.person(id),recorded_at timestamptz not null default now()
);
create table private.identity_event(
 id uuid primary key default gen_random_uuid(),invitation_id uuid not null references private.staff_invitation(id),
 phase text not null check(phase in ('invite_prepared','invite_finished','activate_prepared','activate_finished','cancelled')),
 actor_id uuid not null references public.person(id),auth_user_id uuid,recorded_at timestamptz not null default now(),unique(invitation_id,phase)
);
create table private.identity_receipt(request_id uuid primary key,actor_id uuid not null references public.person(id),payload jsonb not null,result jsonb not null,recorded_at timestamptz not null default now());
create index on private.staff_invitation(person_id,recorded_at desc);
create index on private.staff_invitation(organisation_id);
create index on private.staff_invitation(created_by);
create index on private.identity_event(actor_id);
create index on private.identity_receipt(actor_id);
do $$declare tbl text;begin foreach tbl in array array['staff_invitation','identity_event','identity_receipt'] loop
 execute format('alter table private.%I enable row level security',tbl);execute format('revoke all on private.%I from public,anon,authenticated',tbl);
 execute format('grant select,insert on private.%I to yapesa_identity',tbl);
 execute format('create policy identity_access on private.%I for all to yapesa_identity using(private.session_active(false)) with check(private.session_active(false))',tbl);
 execute format('create trigger immutable_record before update or delete on private.%I for each row execute function private.immutable_record()',tbl);
 end loop;end $$;
grant usage on schema public,private,auth to yapesa_identity;
grant execute on function private.is_platform_admin(),private.session_active(boolean),private.current_person(),private.has_role(uuid,text[]),private.requires_mfa(),private.can_read_org(uuid),private.is_officer(uuid),private.person_visible(uuid) to yapesa_identity;
grant select on public.person,public.organisation,public.membership to yapesa_identity;
grant insert(display_name,phone,country_code) on public.person to yapesa_identity;
grant update(auth_user_id) on public.person to yapesa_identity;
grant insert on public.membership,public.audit_log to yapesa_identity;
create policy identity_person_read on public.person for select to yapesa_identity using(private.session_active(false) and (id=private.current_person() or private.is_platform_admin()));
create policy identity_person_insert on public.person for insert to yapesa_identity with check(private.is_platform_admin());
create policy identity_person_link on public.person for update to yapesa_identity using(private.is_platform_admin()) with check(private.is_platform_admin());
create policy identity_org_read on public.organisation for select to yapesa_identity using(private.session_active(false));
create policy identity_membership_read on public.membership for select to yapesa_identity using(private.session_active(false));
create policy identity_membership_activate on public.membership for insert to yapesa_identity with check(person_id=private.current_person() and private.session_active(true) and role in ('secretary','treasurer','chair'));
create policy identity_audit_insert on public.audit_log for insert to yapesa_identity with check(private.session_active(false) and actor_id=private.current_person());

-- Auth lookups return bounded identity metadata, never password/factor secrets.
create function private.identity_auth(p_phone text,p_invitation uuid,p_person uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u auth.users;person_user uuid;begin
 if not private.is_platform_admin() and (not private.session_active(false) or p_person is distinct from private.current_person()) then raise exception 'Not permitted' using errcode='42501';end if;
 select auth_user_id into person_user from public.person where id=p_person and phone=p_phone;
 select * into u from auth.users where phone=ltrim(p_phone,'+');
 if u.id is null then return null;end if;
 if u.raw_app_meta_data->>'yapesa_invitation_id' is distinct from p_invitation::text or (person_user is not null and person_user<>u.id) then raise exception 'Existing account needs verified identity linking' using errcode='22023';end if;
 return jsonb_build_object('id',u.id,'phone_confirmed',u.phone_confirmed_at is not null,'activation',u.raw_app_meta_data->>'yapesa_activation');
end $$;
revoke all on function private.identity_auth(text,uuid,uuid) from public,anon,authenticated;
grant execute on function private.identity_auth(text,uuid,uuid) to yapesa_identity;
create function private.identity_admin_eligible(p_person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.session_active(false) and exists(select 1 from public.membership m join public.organisation o on o.id=m.organisation_id join public.person p on p.id=m.person_id join auth.users u on u.id=p.auth_user_id where m.person_id=p_person and m.role='fencher_admin' and o.type='fencher' and o.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()) and u.phone_confirmed_at is not null and exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.factor_type='totp' and f.status::text='verified'));
$$;
revoke all on function private.identity_admin_eligible(uuid) from public,anon,authenticated;
grant execute on function private.identity_admin_eligible(uuid) to yapesa_identity;
create function private.identity_gateway() returns boolean language sql stable security definer set search_path='' as $$select private.session_active(false) and private.gateway_allowed();$$;
revoke all on function private.identity_gateway() from public,anon,authenticated;
grant execute on function private.identity_gateway() to yapesa_identity;
create function private.identity_begin(p_request uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare prior private.identity_receipt;begin
 if not private.session_active(false) or private.current_person() is null or p_request is null or p_request::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then raise exception 'Valid request required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,17));
 select * into prior from private.identity_receipt where request_id=p_request;
 if found then if prior.actor_id<>private.current_person() or prior.payload<>p_payload then raise exception 'Idempotency conflict' using errcode='23505';end if;return prior.result;end if;return null;
end $$;
revoke all on function private.identity_begin(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.identity_begin(uuid,jsonb) to yapesa_identity;
create function private.staff_invite(p_request uuid,p_org uuid,p_person uuid,p_name text,p_phone text,p_email text,p_role text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;prior jsonb;target public.person;country text;invitation uuid:=gen_random_uuid();result jsonb;begin
 if not private.is_platform_admin() then raise exception 'Verified administrator required' using errcode='42501';end if;
 payload:=jsonb_build_object('action','staff_invite','org',p_org,'person',p_person,'name',p_name,'phone',p_phone,'email',p_email,'role',p_role,'reason',p_reason);
 prior:=private.identity_begin(p_request,payload);if prior is not null then return prior;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not private.is_platform_admin() then raise exception 'Authority changed' using errcode='42501';end if;
 select country_code into country from public.organisation where id=p_org and type='group' and status='active';
 if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Real staff email required for authenticator setup' using errcode='22023';end if;
 if country is null or p_role is null or p_role not in ('secretary','treasurer','chair') or p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$' or p_reason is null or length(p_reason) not between 1 and 500 or p_reason !~ '[^[:space:]]' then raise exception 'Valid group, phone, role and reason required' using errcode='22023';end if;
 if p_person is null then
  if p_name is null or length(btrim(p_name)) not between 1 and 150 then raise exception 'Name required' using errcode='22023';end if;
  insert into public.person(display_name,phone,country_code) values(btrim(p_name),p_phone,country) returning * into target;
 else
  select * into strict target from public.person where id=p_person and phone=p_phone;
  if coalesce(p_name,'')<>'' then raise exception 'Existing identity cannot be renamed by invitation' using errcode='22023';end if;
 end if;
 if exists(select 1 from public.membership where person_id=target.id and role<>'member' and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'Unlinked staff identity requires a separately verified existing-account workflow' using errcode='22023';end if;
 if target.auth_user_id is not null then raise exception 'Existing accounts use verified role assignment' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(target.id::text,18));
 if exists(select 1 from private.staff_invitation i where i.person_id=target.id and not exists(select 1 from private.identity_event e where e.invitation_id=i.id and e.phase='cancelled')) then raise exception 'Invitation already exists' using errcode='23505';end if;
 insert into private.staff_invitation(id,organisation_id,person_id,role,phone,email,reason,created_by) values(invitation,p_org,target.id,p_role,p_phone,lower(btrim(p_email)),p_reason,private.current_person());
 result:=jsonb_build_object('id',invitation);
 insert into private.identity_receipt(request_id,actor_id,payload,result) values(p_request,private.current_person(),payload,result);
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(p_org,private.current_person(),private.identity_service_device(),'staff_invitation_created',invitation,jsonb_build_object('person_id',target.id,'role',p_role));
 return result;
end $$;

create function private.staff_job(p_invitation uuid,p_phase text,p_finish boolean,p_auth uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation private.staff_invitation;auth_data jsonb;actor uuid;prepared text;finished text;result jsonb;begin
 if not private.session_active(false) or p_finish is null or p_phase is null or p_phase not in ('invite','activate') then raise exception 'Not permitted' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_invitation::text,19));
 select * into strict invitation from private.staff_invitation where id=p_invitation;
 actor:=private.current_person();
 if (p_phase='invite' and not private.is_platform_admin()) or (p_phase='activate' and (actor is distinct from invitation.person_id or not private.session_active(true))) then raise exception 'Verified job actor required' using errcode='42501';end if;
 if exists(select 1 from private.identity_event where invitation_id=invitation.id and phase='cancelled') then raise exception 'Invitation cancelled' using errcode='22023';end if;
 prepared:=p_phase||'_prepared';finished:=p_phase||'_finished';
 auth_data:=private.identity_auth(invitation.phone,invitation.id,invitation.person_id);
 if p_phase='activate' and (auth_data is null or auth_data->>'id' is distinct from auth.uid()::text or auth_data->>'phone_confirmed'<>'true' or not private.identity_admin_eligible(invitation.created_by) or not exists(select 1 from public.organisation where id=invitation.organisation_id and type='group' and status='active')) then raise exception 'Activation prerequisites changed' using errcode='42501';end if;
 if exists(select 1 from private.identity_event where invitation_id=invitation.id and phase=finished) then return jsonb_build_object('id',invitation.id,'done',true,'auth_user_id',auth_data->>'id');end if;
 if not private.identity_gateway() then raise exception 'Server job gateway required' using errcode='42501';end if;
 if not p_finish then
  insert into private.identity_event(invitation_id,phase,actor_id) values(invitation.id,prepared,actor) on conflict do nothing;
  insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(invitation.organisation_id,actor,private.identity_service_device(),'identity_service_job_prepared',invitation.id,jsonb_build_object('phase',p_phase));
 else
  if not exists(select 1 from private.identity_event where invitation_id=invitation.id and phase=prepared) or auth_data is null or p_auth::text is distinct from auth_data->>'id' then raise exception 'Verified Auth result required' using errcode='22023';end if;
  if p_phase='invite' then
   update public.person set auth_user_id=p_auth where id=invitation.person_id and (auth_user_id is null or auth_user_id=p_auth);
   if not found then raise exception 'Identity link conflict' using errcode='23505';end if;
  else
   if auth_data->>'activation' is distinct from 'active' then raise exception 'Auth activation not confirmed' using errcode='22023';end if;
   insert into public.membership(person_id,organisation_id,role) values(invitation.person_id,invitation.organisation_id,invitation.role) on conflict do nothing;
  end if;
  insert into private.identity_event(invitation_id,phase,actor_id,auth_user_id) values(invitation.id,finished,actor,p_auth);
  insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(invitation.organisation_id,actor,private.identity_service_device(),'identity_service_job_finished',invitation.id,jsonb_build_object('phase',p_phase,'person_id',invitation.person_id));
 end if;
 return jsonb_build_object('id',invitation.id,'done',p_finish,'auth_user_id',auth_data->>'id');
end $$;

-- The hosted Edge Function reads only already-prepared, actor-authorized jobs.
create function private.staff_job_context(p_invitation uuid,p_phase text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare invitation private.staff_invitation;auth_data jsonb;begin
 if p_phase is null or p_phase not in ('invite','activate') or not private.session_active(false) then raise exception 'Not permitted' using errcode='42501';end if;
 select * into strict invitation from private.staff_invitation where id=p_invitation;
 if (p_phase='invite' and not private.is_platform_admin()) or (p_phase='activate' and (private.current_person() is distinct from invitation.person_id or not private.session_active(true))) then raise exception 'Not permitted' using errcode='42501';end if;
 if exists(select 1 from private.identity_event where invitation_id=invitation.id and phase='cancelled') or not exists(select 1 from private.identity_event where invitation_id=invitation.id and phase=p_phase||'_prepared') then raise exception 'Prepared job required' using errcode='42501';end if;
 if p_phase='activate' and not private.identity_admin_eligible(invitation.created_by) then raise exception 'Invitation authorizer no longer eligible' using errcode='42501';end if;
 auth_data:=private.identity_auth(invitation.phone,invitation.id,invitation.person_id);
 return jsonb_build_object('id',invitation.id,'phase',p_phase,'email',invitation.email,'phone',invitation.phone,'auth_user_id',auth_data->>'id','done',exists(select 1 from private.identity_event where invitation_id=invitation.id and phase=p_phase||'_finished'));
end $$;

create function private.staff_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not private.is_platform_admin() then raise exception 'Verified administrator required' using errcode='42501';end if;
 return jsonb_build_object('invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'organisation_id',i.organisation_id,'person_id',i.person_id,'name',p.display_name,'phone',i.phone,'email',i.email,'role',i.role,'recorded_at',i.recorded_at,'reason',i.reason,'account_created',exists(select 1 from private.identity_event where invitation_id=i.id and phase='invite_finished'),'activated',exists(select 1 from private.identity_event where invitation_id=i.id and phase='activate_finished'),'cancelled',exists(select 1 from private.identity_event where invitation_id=i.id and phase='cancelled')) order by i.recorded_at desc,i.id) from private.staff_invitation i join public.person p on p.id=i.person_id),'[]'::jsonb));
end $$;
create function private.staff_pending_activation() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not private.session_active(true) then raise exception 'Verified authenticator required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(i.id order by i.recorded_at,i.id) from private.staff_invitation i where i.person_id=private.current_person() and exists(select 1 from private.identity_event where invitation_id=i.id and phase='invite_finished') and not exists(select 1 from private.identity_event where invitation_id=i.id and phase in ('activate_finished','cancelled'))),'[]'::jsonb);
end $$;
-- These are narrow, nonfinancial identity functions, not table-write APIs.
grant create on schema private to yapesa_identity;
do $$declare signature text;begin foreach signature in array array['staff_invite(uuid,uuid,uuid,text,text,text,text,text)','staff_job(uuid,text,boolean,uuid)','staff_job_context(uuid,text)','staff_workspace()','staff_pending_activation()'] loop
 execute format('alter function private.%s owner to yapesa_identity',signature);execute format('revoke all on function private.%s from public,anon,authenticated',signature);execute format('grant execute on function private.%s to authenticated',signature);end loop;end $$;
revoke create on schema private from yapesa_identity;
create function public.staff_invite(p_request uuid,p_org uuid,p_person uuid default null,p_name text default '',p_phone text default '',p_email text default '',p_role text default '',p_reason text default '') returns jsonb language sql security invoker set search_path='' as $$select private.staff_invite(p_request,p_org,p_person,p_name,p_phone,p_email,p_role,p_reason);$$;
create function public.staff_job(p_invitation uuid,p_phase text,p_finish boolean default false,p_auth uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.staff_job(p_invitation,p_phase,p_finish,p_auth);$$;
create function public.staff_job_context(p_invitation uuid,p_phase text) returns jsonb language sql security invoker set search_path='' as $$select private.staff_job_context(p_invitation,p_phase);$$;
create function public.staff_workspace() returns jsonb language sql security invoker set search_path='' as $$select private.staff_workspace();$$;
create function public.staff_pending_activation() returns jsonb language sql security invoker set search_path='' as $$select private.staff_pending_activation();$$;
revoke all on function public.staff_invite(uuid,uuid,uuid,text,text,text,text,text),public.staff_job(uuid,text,boolean,uuid),public.staff_job_context(uuid,text),public.staff_workspace(),public.staff_pending_activation() from public,anon,authenticated;
grant execute on function public.staff_invite(uuid,uuid,uuid,text,text,text,text,text),public.staff_job(uuid,text,boolean,uuid),public.staff_job_context(uuid,text),public.staff_workspace(),public.staff_pending_activation() to authenticated;

create or replace function public.session_context() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('person_id',p.id,'display_name',p.display_name,'requires_mfa',private.requires_mfa(),'mfa_verified',private.session_active(true),'can_administer',private.is_platform_admin(),
 'activation_pending',case when private.session_active(true) then jsonb_array_length(private.staff_pending_activation())>0 else false end) from public.person p where p.id=private.current_person();
$$;
