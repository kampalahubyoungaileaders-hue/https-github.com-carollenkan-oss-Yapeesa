-- Programme relationships and aggregate reports never grant group-member access.
alter table public.organisation add column parent_programme_id uuid references public.organisation(id);
alter table public.organisation add constraint group_programme_only check(parent_programme_id is null or (type='group' and parent_programme_id<>id));
create index organisation_parent_programme on public.organisation(parent_programme_id) where parent_programme_id is not null;
create function private.check_programme_parent() returns trigger language plpgsql set search_path='' as $$begin
 if new.parent_programme_id is not null and not exists(select 1 from public.organisation p where p.id=new.parent_programme_id and p.type='programme' and p.status='active') then raise exception 'Active parent programme required' using errcode='22023';end if;return new;
end $$;
revoke all on function private.check_programme_parent() from public,anon,authenticated;
create trigger valid_programme_parent before insert or update of parent_programme_id on public.organisation for each row execute function private.check_programme_parent();
grant update(parent_programme_id) on public.organisation to yapesa_administrator;

do $$begin if not exists(select 1 from pg_roles where rolname='yapesa_programmes') then create role yapesa_programmes nologin noinherit nobypassrls;end if;end $$;
grant yapesa_programmes to postgres;
grant usage on schema public,private to yapesa_programmes;
create function private.programme_organisations() returns setof uuid language plpgsql stable security definer set search_path='' as $$begin
 if private.is_platform_admin() then return query select id from public.organisation where type='programme' and status='active';return;end if;
 if not private.session_active(true) then return;end if;
 return query select o.id from public.organisation o where o.type='programme' and o.status='active' and private.has_role(o.id,array['programme_officer']);
end $$;
create function private.programme_groups() returns setof uuid language sql stable security definer set search_path='' as $$select id from public.organisation where type='group' and parent_programme_id in(select private.programme_organisations());$$;
revoke all on function private.programme_organisations(),private.programme_groups() from public,anon,authenticated;
grant execute on function private.programme_organisations(),private.programme_groups() to yapesa_programmes;
grant select on public.organisation,public.currency_reference,public.membership,public.meeting,public.meeting_session,public.meeting_roster,public.attendance,public.group_txn,public.group_loan,public.loan_event to yapesa_programmes;
create policy programme_org_read on public.organisation for select to yapesa_programmes using(id in(select private.programme_organisations()) or id in(select private.programme_groups()));
create policy programme_currency_read on public.currency_reference for select to yapesa_programmes using(true);
do $$declare tbl text;begin foreach tbl in array array['membership','meeting','meeting_session','meeting_roster','attendance','group_txn','group_loan','loan_event'] loop
 execute format('create policy scoped_programme_aggregate on public.%I for select to yapesa_programmes using(organisation_id in(select private.programme_groups()))',tbl);
end loop;end $$;

create function private.programme_list() returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'time_zone',time_zone) order by name,id),'[]'::jsonb) from public.organisation where id in(select private.programme_organisations());$$;
create function private.programme_report(p_org uuid,p_asof date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org public.organisation;day date;result jsonb;begin
 if not exists(select 1 from private.programme_organisations() allowed(id) where allowed.id=p_org) then raise exception 'Verified programme access required' using errcode='42501';end if;
 select * into strict org from public.organisation where id=p_org;
 day:=coalesce(p_asof,(now() at time zone org.time_zone)::date);
 if day<'2000-01-01' or day>'2099-12-31' then raise exception 'Report date outside supported range' using errcode='22023';end if;
 if (select count(*) from public.organisation where parent_programme_id=p_org)>500 then raise exception 'Programme too large for this extract' using errcode='54000';end if;
 with linked_groups as materialized(select o.*,c.minor_digits from public.organisation o join public.currency_reference c on c.code=o.currency where o.parent_programme_id=p_org),
 meetings as materialized(select m.* from public.meeting m join linked_groups g on g.id=m.organisation_id where m.meeting_date<=day and (exists(select 1 from public.meeting_session ms where ms.meeting_id=m.id) or exists(select 1 from public.group_txn gt where gt.meeting_id=m.id))),
 events as materialized(select e.*,m.meeting_date from public.loan_event e join public.meeting m on m.id=e.meeting_id join linked_groups g on g.id=e.organisation_id where m.meeting_date<=day),
 live_loans as materialized(select l.* from public.group_loan l join linked_groups g on g.id=l.organisation_id where exists(select 1 from events e where e.loan_id=l.id and e.kind='disbursement' and not exists(select 1 from events r where r.reverses=e.id))),
 paid as (select e.loan_id,a->>'period' period,sum((case when e.kind='repayment' then 1 else -1 end)*(a->>'principal')::numeric) principal,sum((case when e.kind='repayment' then 1 else -1 end)*(a->>'interest')::numeric) interest from events e cross join lateral jsonb_array_elements(e.allocations) a where e.kind in('repayment','reversal') group by e.loan_id,a->>'period'),
 instalments as materialized(select l.organisation_id,l.id loan_id,(s->>'due')::date due,(s->>'principal')::numeric principal,(s->>'interest')::numeric interest,greatest(0,(s->>'principal')::numeric-coalesce(p.principal,0)) principal_left,greatest(0,(s->>'interest')::numeric-coalesce(p.interest,0)) interest_left from live_loans l cross join lateral jsonb_array_elements(l.schedule) s left join paid p on p.loan_id=l.id and p.period=s->>'period'),
 latest_attendance as materialized(select distinct on(a.meeting_id,a.member_id) a.* from public.attendance a join meetings m on m.id=a.meeting_id order by a.meeting_id,a.member_id,a.revision desc),
 months as(select generate_series(date_trunc('month',day::timestamp)-interval '11 months',date_trunc('month',day::timestamp),interval '1 month')::date as month_start),
 group_rows as(select g.id,g.name,g.status,g.currency,g.minor_digits,g.time_zone,
 (select count(distinct person_id)::text from public.membership where organisation_id=g.id and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) members,
 (select max(meeting_date) from meetings where organisation_id=g.id) last_meeting,
 coalesce((select sum(t.amount::numeric)::text from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.organisation_id=g.id and m.meeting_date<=day),'0') share_contributions,
 coalesce((select sum(principal_left)::text from instalments where organisation_id=g.id),'0') outstanding_principal,
 coalesce((select sum(principal_left+interest_left)::text from instalments where organisation_id=g.id and due<day),'0') arrears,
 (select count(distinct loan_id)::text from instalments where organisation_id=g.id and due<day and principal_left+interest_left>0) loans_in_arrears,
 jsonb_build_object('days_1_30',coalesce((select sum(principal_left+interest_left)::text from instalments where organisation_id=g.id and day-due between 1 and 30),'0'),'days_31_60',coalesce((select sum(principal_left+interest_left)::text from instalments where organisation_id=g.id and day-due between 31 and 60),'0'),'days_61_90',coalesce((select sum(principal_left+interest_left)::text from instalments where organisation_id=g.id and day-due between 61 and 90),'0'),'days_over_90',coalesce((select sum(principal_left+interest_left)::text from instalments where organisation_id=g.id and day-due>90),'0')) ageing,
 (select jsonb_agg(jsonb_build_object('month',mo.month_start,
 'meetings',(select count(*)::text from meetings m where m.organisation_id=g.id and date_trunc('month',m.meeting_date)=mo.month_start),
 'roster',(select count(*)::text from public.meeting_roster r join meetings m on m.id=r.meeting_id where r.organisation_id=g.id and date_trunc('month',m.meeting_date)=mo.month_start),
 'present',(select count(*)::text from latest_attendance a join meetings m on m.id=a.meeting_id where a.organisation_id=g.id and a.status='present' and date_trunc('month',m.meeting_date)=mo.month_start),
 'absent',(select count(*)::text from latest_attendance a join meetings m on m.id=a.meeting_id where a.organisation_id=g.id and a.status='absent' and date_trunc('month',m.meeting_date)=mo.month_start),
 'excused',(select count(*)::text from latest_attendance a join meetings m on m.id=a.meeting_id where a.organisation_id=g.id and a.status='excused' and date_trunc('month',m.meeting_date)=mo.month_start),
 'scheduled_due',coalesce((select sum(principal+interest)::text from instalments i where i.organisation_id=g.id and i.due<=day and date_trunc('month',i.due)=mo.month_start),'0'),
 'repayments',coalesce((select sum(cash::numeric)::text from events e where e.organisation_id=g.id and (e.kind='repayment' or (e.kind='reversal' and jsonb_array_length(e.allocations)>0)) and date_trunc('month',e.meeting_date)=mo.month_start),'0'),
 'shares',coalesce((select sum(t.amount::numeric)::text from public.group_txn t join meetings m on m.id=t.meeting_id where t.organisation_id=g.id and date_trunc('month',m.meeting_date)=mo.month_start),'0')) order by mo.month_start) from months mo) trends
 from linked_groups g)
 select jsonb_build_object('id',org.id,'name',org.name,'as_of',day,'time_zone',org.time_zone,'groups',coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('days_since_meeting',case when r.last_meeting is null then null else (day-r.last_meeting)::text end,'meeting_attention',r.status='active' and (r.last_meeting is null or r.last_meeting<=day-21),'repayment_attention',r.status='active' and r.arrears::numeric>0)),'[]'::jsonb)) into result from (select * from group_rows order by name,id) r;
 return result;
end $$;

create function private.admin_programme_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not private.is_platform_admin() then raise exception 'Verified administrator required' using errcode='42501';end if;
 return jsonb_build_object('programmes',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'country_code',o.country_code,'currency',o.currency,'time_zone',o.time_zone,'groups',coalesce((select jsonb_agg(g.id order by g.id) from public.organisation g where g.parent_programme_id=o.id),'[]'::jsonb),'officers',coalesce((select jsonb_agg(m.person_id order by m.person_id) from public.membership m where m.organisation_id=o.id and m.role='programme_officer' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())),'[]'::jsonb)) order by o.name,o.id) from public.organisation o where o.type='programme' and o.status='active'),'[]'::jsonb));
end $$;
create function private.admin_programme(p_request uuid,p_device uuid,p_action text,p_programme uuid,p_group uuid,p_person uuid,p_enabled boolean,p_name text,p_country text,p_currency text,p_zone text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;prior jsonb;id uuid;old_parent uuid;begin
 payload:=jsonb_build_object('device_id',p_device,'action',p_action,'programme_id',p_programme,'group_id',p_group,'person_id',p_person,'enabled',p_enabled,'name',p_name,'country',p_country,'currency',p_currency,'zone',p_zone,'reason',p_reason);
 prior:=private.admin_begin(p_request,'programme_'||p_action,payload);if prior is not null then return prior;end if;
 if p_device is null or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'Recorded reason required' using errcode='22023';end if;
 if p_action='create' then
  if p_programme is not null or p_group is not null or p_person is not null or p_enabled is not null or p_name is null or length(btrim(p_name)) not between 1 and 200 or p_country is null or p_country!~'^[A-Z]{2}$' or not exists(select 1 from public.currency_reference where code=p_currency) or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone) then raise exception 'Invalid programme configuration' using errcode='22023';end if;
  insert into public.organisation(name,type,country_code,currency,time_zone) values(btrim(p_name),'programme',p_country,p_currency,p_zone) returning organisation.id into id;
  return private.admin_finish(p_request,'programme_'||p_action,payload,jsonb_build_object('id',id),id,p_device,id);
 end if;
 if p_programme is null or not exists(select 1 from public.organisation where organisation.id=p_programme and type='programme' and status='active') or coalesce(p_name,'')<>'' or coalesce(p_country,'')<>'' or coalesce(p_currency,'')<>'' or coalesce(p_zone,'')<>'' or p_enabled is null then raise exception 'Invalid programme command' using errcode='22023';end if;
 if p_action='link_group' then
  if p_person is not null or p_group is null then raise exception 'Group required' using errcode='22023';end if;
  select parent_programme_id into old_parent from public.organisation where organisation.id=p_group and type='group' for update;
  if not found or (not p_enabled and old_parent is distinct from p_programme) then raise exception 'Invalid linked group' using errcode='22023';end if;
  -- Relinking must first explicitly unlink the original programme.
  if p_enabled and old_parent is not null and old_parent<>p_programme then raise exception 'Unlink existing programme first' using errcode='23505';end if;
  update public.organisation set parent_programme_id=case when p_enabled then p_programme else null end where organisation.id=p_group;
  return private.admin_finish(p_request,'programme_'||p_action,payload,jsonb_build_object('id',p_group,'previous_programme_id',old_parent),p_group,p_device,p_group);
 elsif p_action='officer' then
  if p_group is not null or p_person is null or not exists(select 1 from public.person where person.id=p_person) or (p_enabled and not private.staff_ready(p_person)) then raise exception 'Verified existing staff required' using errcode='22023';end if;
  if p_enabled then insert into public.membership(person_id,organisation_id,role) values(p_person,p_programme,'programme_officer') on conflict(person_id,organisation_id,role) do update set starts_at=case when public.membership.ends_at is null and public.membership.starts_at<=now() then public.membership.starts_at else now() end,ends_at=null;
  else update public.membership set ends_at=clock_timestamp() where person_id=p_person and organisation_id=p_programme and role='programme_officer' and starts_at<=now() and (ends_at is null or ends_at>now());end if;
  return private.admin_finish(p_request,'programme_'||p_action,payload,jsonb_build_object('id',p_person),p_programme,p_device,p_person);
 end if;
 raise exception 'Invalid programme action' using errcode='22023';
end $$;
-- Keep the idempotency document identical before and after a link operation.
-- The audit event already records the requested programme and explicit link/unlink action.

grant create on schema private to yapesa_programmes,yapesa_administrator;
alter function private.programme_list() owner to yapesa_programmes;
alter function private.programme_report(uuid,date) owner to yapesa_programmes;
alter function private.admin_programme_workspace() owner to yapesa_administrator;
alter function private.admin_programme(uuid,uuid,text,uuid,uuid,uuid,boolean,text,text,text,text,text) owner to yapesa_administrator;
revoke create on schema private from yapesa_programmes,yapesa_administrator;
revoke all on function private.programme_list(),private.programme_report(uuid,date),private.admin_programme_workspace(),private.admin_programme(uuid,uuid,text,uuid,uuid,uuid,boolean,text,text,text,text,text) from public,anon,authenticated;
grant execute on function private.programme_list(),private.programme_report(uuid,date),private.admin_programme_workspace(),private.admin_programme(uuid,uuid,text,uuid,uuid,uuid,boolean,text,text,text,text,text) to authenticated;
create function public.programme_list() returns jsonb language sql stable security invoker set search_path='' as $$select private.programme_list();$$;
create function public.programme_report(p_org uuid,p_asof date default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.programme_report(p_org,p_asof);$$;
create function public.admin_programme_workspace() returns jsonb language sql stable security invoker set search_path='' as $$select private.admin_programme_workspace();$$;
create function public.admin_programme(p_request uuid,p_device uuid,p_action text,p_programme uuid,p_group uuid,p_person uuid,p_enabled boolean,p_name text,p_country text,p_currency text,p_zone text,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select private.admin_programme(p_request,p_device,p_action,p_programme,p_group,p_person,p_enabled,p_name,p_country,p_currency,p_zone,p_reason);$$;
revoke all on function public.programme_list(),public.programme_report(uuid,date),public.admin_programme_workspace(),public.admin_programme(uuid,uuid,text,uuid,uuid,uuid,boolean,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.programme_list(),public.programme_report(uuid,date),public.admin_programme_workspace(),public.admin_programme(uuid,uuid,text,uuid,uuid,uuid,boolean,text,text,text,text,text) to authenticated;

-- Programme officers use the same phone, PIN and authenticator activation job.
alter table private.staff_invitation drop constraint staff_invitation_role_check;
alter table private.staff_invitation add constraint staff_invitation_role_check check(role in ('secretary','treasurer','chair','programme_officer'));
drop policy identity_membership_activate on public.membership;
create policy identity_membership_activate on public.membership for insert to yapesa_identity with check(person_id=private.current_person() and private.session_active(true) and role in ('secretary','treasurer','chair','programme_officer'));
create or replace function private.staff_invite(p_request uuid,p_org uuid,p_person uuid,p_name text,p_phone text,p_email text,p_role text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;prior jsonb;target public.person;country text;invitation uuid:=gen_random_uuid();result jsonb;begin
 if not private.is_platform_admin() then raise exception 'Verified administrator required' using errcode='42501';end if;
 payload:=jsonb_build_object('action','staff_invite','org',p_org,'person',p_person,'name',p_name,'phone',p_phone,'email',p_email,'role',p_role,'reason',p_reason);
 prior:=private.identity_begin(p_request,payload);if prior is not null then return prior;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not private.is_platform_admin() then raise exception 'Authority changed' using errcode='42501';end if;
 select country_code into country from public.organisation where id=p_org and status='active' and ((type='group' and p_role in ('secretary','treasurer','chair')) or (type='programme' and p_role='programme_officer'));
 if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Real staff email required for authenticator setup' using errcode='22023';end if;
 if country is null or p_role is null or p_role not in ('secretary','treasurer','chair','programme_officer') or p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$' or p_reason is null or length(p_reason) not between 1 and 500 or p_reason !~ '[^[:space:]]' then raise exception 'Valid organisation, phone, role and reason required' using errcode='22023';end if;
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
create or replace function private.staff_job(p_invitation uuid,p_phase text,p_finish boolean,p_auth uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation private.staff_invitation;auth_data jsonb;actor uuid;prepared text;finished text;result jsonb;begin
 if not private.session_active(false) or p_finish is null or p_phase is null or p_phase not in ('invite','activate') then raise exception 'Not permitted' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_invitation::text,19));
 select * into strict invitation from private.staff_invitation where id=p_invitation;
 actor:=private.current_person();
 if (p_phase='invite' and not private.is_platform_admin()) or (p_phase='activate' and (actor is distinct from invitation.person_id or not private.session_active(true))) then raise exception 'Verified job actor required' using errcode='42501';end if;
 if exists(select 1 from private.identity_event where invitation_id=invitation.id and phase='cancelled') then raise exception 'Invitation cancelled' using errcode='22023';end if;
 prepared:=p_phase||'_prepared';finished:=p_phase||'_finished';
 auth_data:=private.identity_auth(invitation.phone,invitation.id,invitation.person_id);
 if p_phase='activate' and (auth_data is null or auth_data->>'id' is distinct from (select auth_user_id::text from public.person where id=actor) or auth_data->>'phone_confirmed'<>'true' or not private.identity_admin_eligible(invitation.created_by) or not exists(select 1 from public.organisation where id=invitation.organisation_id and status='active' and ((type='group' and invitation.role in ('secretary','treasurer','chair')) or (type='programme' and invitation.role='programme_officer')))) then raise exception 'Activation prerequisites changed' using errcode='42501';end if;
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
