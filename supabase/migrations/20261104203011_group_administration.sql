-- Verified platform administration. No Auth credentials or financial postings
-- are created here. The executor cannot log in, bypass RLS or write Auth tables.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='yapesa_administrator') then
  create role yapesa_administrator nologin noinherit nobypassrls;
 end if;
end $$;
grant yapesa_administrator to postgres;
grant usage on schema public,private to yapesa_administrator;

create function private.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.session_active(true) and exists(
 select 1 from public.membership m join public.person p on p.id=m.person_id join auth.users u on u.id=p.auth_user_id join public.organisation o on o.id=m.organisation_id
 where p.auth_user_id=auth.uid() and u.phone_confirmed_at is not null and m.role='fencher_admin' and o.type='fencher' and o.status='active'
 and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()));
$$;
revoke all on function private.is_platform_admin() from public,anon;
grant execute on function private.is_platform_admin() to authenticated,yapesa_poster,yapesa_administrator;
grant execute on function private.session_active(boolean),private.current_person() to yapesa_administrator;

create or replace function private.can_read_org(p_org uuid) returns boolean language sql stable set search_path='' as $$
 select private.is_platform_admin() or (private.session_active(private.requires_mfa()) and private.has_role(p_org,array['member','secretary','treasurer','chair']));
$$;
create or replace function private.is_officer(p_org uuid) returns boolean language sql stable set search_path='' as $$
 select private.is_platform_admin() or (private.session_active(true) and private.has_role(p_org,array['secretary','treasurer','chair']));
$$;
create or replace function public.session_context() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('person_id',p.id,'display_name',p.display_name,'requires_mfa',private.requires_mfa(),'mfa_verified',private.session_active(true),'can_administer',private.is_platform_admin())
 from public.person p where p.id=private.current_person();
$$;

create table private.admin_receipt(request_id uuid primary key, request jsonb not null, result jsonb not null, accepted_at timestamptz not null default now());
alter table private.admin_receipt enable row level security;
revoke all on private.admin_receipt from public,anon,authenticated;
grant select,insert on private.admin_receipt to yapesa_administrator;
create policy verified_admin_receipt on private.admin_receipt for all to yapesa_administrator using(private.is_platform_admin()) with check(private.is_platform_admin());
create trigger immutable_record before update or delete on private.admin_receipt for each row execute function private.immutable_record();

grant select on public.organisation,public.person,public.membership,public.group_settings,public.cycle,public.currency_reference,public.group_txn to yapesa_administrator;
grant insert on public.organisation,public.membership,public.group_settings,public.cycle,public.ledger_account,public.audit_log to yapesa_administrator;
grant insert(display_name,phone,country_code) on public.person to yapesa_administrator;
grant update(name) on public.organisation to yapesa_administrator;
grant update(starts_at,ends_at) on public.membership to yapesa_administrator;
grant update(max_shares_per_meeting) on public.group_settings to yapesa_administrator;
grant update(starts_on,ends_on) on public.cycle to yapesa_administrator;
create policy admin_currency_read on public.currency_reference for select to yapesa_administrator using(private.is_platform_admin());
create policy admin_txn_read on public.group_txn for select to yapesa_administrator using(private.is_platform_admin());
do $$ declare tbl text; begin
 foreach tbl in array array['organisation','person','membership','group_settings','cycle','ledger_account','audit_log'] loop
 execute format('create policy verified_administration on public.%I for all to yapesa_administrator using(private.is_platform_admin()) with check(private.is_platform_admin())',tbl);
 end loop;
end $$;

-- Only used by the checked administration executor; never returns Auth secrets.
create function private.staff_ready(p_person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_platform_admin() and exists(select 1 from public.person p join auth.users u on u.id=p.auth_user_id
 where p.id=p_person and u.phone_confirmed_at is not null and exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.factor_type='totp' and f.status::text='verified'));
$$;
revoke all on function private.staff_ready(uuid) from public,anon,authenticated;
grant execute on function private.staff_ready(uuid) to yapesa_administrator;

create function private.admin_begin(p_request uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior private.admin_receipt; doc jsonb; begin
 if not private.is_platform_admin() then raise exception 'Verified platform administrator required' using errcode='42501'; end if;
 if p_request is null then raise exception 'Request reference required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,1));
 doc:=jsonb_build_object('actor',private.current_person(),'action',p_action,'payload',p_payload);
 select * into prior from private.admin_receipt where request_id=p_request;
 if found then
  if prior.request<>doc then raise exception 'Request reference conflict' using errcode='23505'; end if;
  return prior.result;
 end if;
 return null;
end $$;
create function private.admin_finish(p_request uuid,p_action text,p_payload jsonb,p_result jsonb,p_org uuid,p_device uuid,p_record uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 insert into private.admin_receipt(request_id,request,result) values(p_request,jsonb_build_object('actor',private.current_person(),'action',p_action,'payload',p_payload),p_result);
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value)
 values(p_org,private.current_person(),p_device,p_action,p_record,p_payload||p_result||jsonb_build_object('request_id',p_request,'source','web-administration'));
 return p_result;
end $$;

create function private.admin_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_platform_admin() then raise exception 'Verified platform administrator required' using errcode='42501'; end if;
 return jsonb_build_object(
 'currencies',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'minor_digits',minor_digits) order by code),'[]') from public.currency_reference),
 'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name,'phone',phone,'has_login',auth_user_id is not null,'staff_ready',private.staff_ready(id)) order by display_name),'[]') from public.person),
 'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'country_code',o.country_code,'currency',o.currency,'time_zone',o.time_zone,'max_shares',gs.max_shares_per_meeting::text,
 'configuration_locked',exists(select 1 from public.group_txn t where t.organisation_id=o.id),
 'cycle',(select jsonb_build_object('starts_on',c.starts_on,'ends_on',c.ends_on,'share_price',c.share_price::text) from public.cycle c where c.organisation_id=o.id and c.status='active'),
 'memberships',(select coalesce(jsonb_agg(jsonb_build_object('person_id',m.person_id,'role',m.role) order by m.person_id,m.role),'[]') from public.membership m where m.organisation_id=o.id and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))) order by o.name),'[]')
 from public.organisation o join public.group_settings gs on gs.organisation_id=o.id where o.type='group' and o.status='active'));
end $$;

create function private.admin_create_group(p_request uuid,p_device uuid,p_name text,p_country text,p_currency text,p_zone text,p_max text,p_starts date,p_ends date,p_price text) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; prior jsonb; org_id uuid; begin
 payload:=jsonb_build_object('device_id',p_device,'name',p_name,'country',p_country,'currency',p_currency,'zone',p_zone,'max_shares',p_max,'starts_on',p_starts,'ends_on',p_ends,'share_price',p_price);
 prior:=private.admin_begin(p_request,'create_group',payload); if prior is not null then return prior; end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 200 or p_country is null or p_country !~ '^[A-Z]{2}$'
 or p_max is null or p_max !~ '^[1-9][0-9]{0,18}$' or p_price is null or p_price !~ '^[1-9][0-9]{0,18}$'
 or p_starts is null or p_ends is null or p_ends<p_starts or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone)
 or not exists(select 1 from public.currency_reference where code=p_currency) then raise exception 'Invalid group configuration' using errcode='22023'; end if;
 insert into public.organisation(name,type,country_code,currency,time_zone) values(btrim(p_name),'group',p_country,p_currency,p_zone) returning id into org_id;
 insert into public.group_settings(organisation_id,max_shares_per_meeting) values(org_id,p_max::bigint);
 insert into public.cycle(organisation_id,starts_on,ends_on,share_price) values(org_id,p_starts,p_ends,p_price::bigint);
 insert into public.ledger_account(organisation_id,code) values(org_id,'cash'),(org_id,'share_capital');
 return private.admin_finish(p_request,'create_group',payload,jsonb_build_object('id',org_id),org_id,p_device,org_id);
end $$;

create function private.admin_add_member(p_request uuid,p_device uuid,p_org uuid,p_existing uuid,p_name text,p_phone text) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; prior jsonb; person_id uuid; country text; begin
 payload:=jsonb_build_object('device_id',p_device,'organisation_id',p_org,'existing_person',p_existing,'name',p_name,'phone',p_phone);
 prior:=private.admin_begin(p_request,'add_member',payload); if prior is not null then return prior; end if;
 select country_code into country from public.organisation where id=p_org and type='group' and status='active';
 if not found then raise exception 'Invalid group' using errcode='22023'; end if;
 if p_existing is not null then
  if coalesce(p_name,'')<>'' or coalesce(p_phone,'')<>'' or not exists(select 1 from public.person where id=p_existing) then raise exception 'Choose a valid existing person' using errcode='22023'; end if;
  person_id:=p_existing;
 else
  if p_name is null or length(btrim(p_name)) not between 1 and 150 or (p_phone is not null and p_phone !~ '^\+[1-9][0-9]{6,14}$') then raise exception 'Invalid member' using errcode='22023'; end if;
  insert into public.person(display_name,phone,country_code) values(btrim(p_name),p_phone,country) returning id into person_id;
 end if;
 insert into public.membership(person_id,organisation_id,role) values(person_id,p_org,'member');
 return private.admin_finish(p_request,'add_member',payload,jsonb_build_object('id',person_id),p_org,p_device,person_id);
end $$;

create function private.admin_set_role(p_request uuid,p_device uuid,p_org uuid,p_person uuid,p_role text,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; prior jsonb; begin
 payload:=jsonb_build_object('device_id',p_device,'organisation_id',p_org,'person_id',p_person,'role',p_role,'enabled',p_enabled);
 prior:=private.admin_begin(p_request,'set_group_role',payload); if prior is not null then return prior; end if;
 if p_enabled is null or p_role is null or p_role not in ('member','secretary','treasurer','chair') or not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') or not exists(select 1 from public.person where id=p_person) then raise exception 'Invalid group role' using errcode='22023'; end if;
 if p_enabled then
  if p_role<>'member' and not private.staff_ready(p_person) then raise exception 'Staff need verified phone and authenticator setup' using errcode='22023'; end if;
  insert into public.membership(person_id,organisation_id,role) values(p_person,p_org,p_role)
  on conflict(person_id,organisation_id,role) do update set starts_at=case when public.membership.ends_at is null and public.membership.starts_at<=now() then public.membership.starts_at else now() end,ends_at=null;
 else
  update public.membership set ends_at=clock_timestamp() where person_id=p_person and organisation_id=p_org and role=p_role and starts_at<=now() and (ends_at is null or ends_at>now());
 end if;
 return private.admin_finish(p_request,'set_group_role',payload,jsonb_build_object('id',p_person),p_org,p_device,p_person);
end $$;

create function private.admin_configure_group(p_request uuid,p_device uuid,p_org uuid,p_name text,p_max text,p_starts date,p_ends date,p_price text) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; prior jsonb; begin
 payload:=jsonb_build_object('device_id',p_device,'organisation_id',p_org,'name',p_name,'max_shares',p_max,'starts_on',p_starts,'ends_on',p_ends,'share_price',p_price);
 prior:=private.admin_begin(p_request,'configure_group',payload); if prior is not null then return prior; end if;
 -- Same organisation lock as posting: configuration cannot race the first purchase.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') or p_name is null or length(btrim(p_name)) not between 1 and 200
 or p_max is null or p_max !~ '^[1-9][0-9]{0,18}$' or p_price is null or p_price !~ '^[1-9][0-9]{0,18}$'
 or p_starts is null or p_ends is null or p_ends<p_starts then raise exception 'Invalid group configuration' using errcode='22023'; end if;
 if exists(select 1 from public.group_txn where organisation_id=p_org) then raise exception 'Posted configuration is locked' using errcode='22023'; end if;
 update public.organisation set name=btrim(p_name) where id=p_org;
 update public.group_settings set max_shares_per_meeting=p_max::bigint where organisation_id=p_org;
 if exists(select 1 from public.cycle where organisation_id=p_org and status='active' and share_price<>p_price::bigint) then raise exception 'Cycle share price is fixed' using errcode='22023'; end if;
 update public.cycle set starts_on=p_starts,ends_on=p_ends where organisation_id=p_org and status='active';
 if not found then insert into public.cycle(organisation_id,starts_on,ends_on,share_price) values(p_org,p_starts,p_ends,p_price::bigint); end if;
 return private.admin_finish(p_request,'configure_group',payload,jsonb_build_object('id',p_org),p_org,p_device,p_org);
end $$;

-- Restrict ownership, default execution and the writable schema after creation.
grant create on schema private to yapesa_administrator;
do $$ declare signature text; begin
 foreach signature in array array['admin_begin(uuid,text,jsonb)','admin_finish(uuid,text,jsonb,jsonb,uuid,uuid,uuid)','admin_workspace()','admin_create_group(uuid,uuid,text,text,text,text,text,date,date,text)','admin_add_member(uuid,uuid,uuid,uuid,text,text)','admin_set_role(uuid,uuid,uuid,uuid,text,boolean)','admin_configure_group(uuid,uuid,uuid,text,text,date,date,text)'] loop
 execute format('alter function private.%s owner to yapesa_administrator',signature);
 execute format('revoke all on function private.%s from public,anon,authenticated',signature);
 end loop;
end $$;
revoke create on schema private from yapesa_administrator;
grant execute on function private.admin_workspace(),private.admin_create_group(uuid,uuid,text,text,text,text,text,date,date,text),private.admin_add_member(uuid,uuid,uuid,uuid,text,text),private.admin_set_role(uuid,uuid,uuid,uuid,text,boolean),private.admin_configure_group(uuid,uuid,uuid,text,text,date,date,text) to authenticated;

create function public.admin_workspace() returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_workspace(); $$;
create function public.admin_create_group(p_request uuid,p_device uuid,p_name text,p_country text,p_currency text,p_zone text,p_max text,p_starts date,p_ends date,p_price text) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_create_group(p_request,p_device,p_name,p_country,p_currency,p_zone,p_max,p_starts,p_ends,p_price); $$;
create function public.admin_add_member(p_request uuid,p_device uuid,p_org uuid,p_existing uuid,p_name text,p_phone text) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_add_member(p_request,p_device,p_org,p_existing,p_name,p_phone); $$;
create function public.admin_set_role(p_request uuid,p_device uuid,p_org uuid,p_person uuid,p_role text,p_enabled boolean) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_set_role(p_request,p_device,p_org,p_person,p_role,p_enabled); $$;
create function public.admin_configure_group(p_request uuid,p_device uuid,p_org uuid,p_name text,p_max text,p_starts date,p_ends date,p_price text) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_configure_group(p_request,p_device,p_org,p_name,p_max,p_starts,p_ends,p_price); $$;
revoke all on function public.admin_workspace(),public.admin_create_group(uuid,uuid,text,text,text,text,text,date,date,text),public.admin_add_member(uuid,uuid,uuid,uuid,text,text),public.admin_set_role(uuid,uuid,uuid,uuid,text,boolean),public.admin_configure_group(uuid,uuid,uuid,text,text,date,date,text) from public,anon;
grant execute on function public.admin_workspace(),public.admin_create_group(uuid,uuid,text,text,text,text,text,date,date,text),public.admin_add_member(uuid,uuid,uuid,uuid,text,text),public.admin_set_role(uuid,uuid,uuid,uuid,text,boolean),public.admin_configure_group(uuid,uuid,uuid,text,text,date,date,text) to authenticated;

-- Revoking membership removes access and purchasing eligibility, while preserving
-- names required to read historical financial records.
create index group_txn_member_history on public.group_txn(member_id,organisation_id);
create or replace function private.person_visible(p_person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.session_active(private.requires_mfa()) and
 (p_person=private.current_person()
 or exists(select 1 from public.membership m where m.person_id=p_person and private.is_officer(m.organisation_id) and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))
 or exists(select 1 from public.group_txn t where t.member_id=p_person and private.is_officer(t.organisation_id)));
$$;
create or replace function public.group_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb; begin
 if not private.can_read_org(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select jsonb_build_object(
 'group',jsonb_build_object('id',o.id,'name',o.name,'currency',o.currency,'time_zone',o.time_zone,'country_code',o.country_code,'minor_digits',cr.minor_digits,'max_shares',gs.max_shares_per_meeting::text,'can_record',private.can_record(o.id)),
 'cycle',(select jsonb_build_object('id',c.id,'starts_on',c.starts_on,'ends_on',c.ends_on,'share_price',c.share_price::text) from public.cycle c where c.organisation_id=o.id and c.status='active'),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'active',exists(select 1 from public.membership m where m.person_id=p.id and m.organisation_id=o.id and m.role='member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))) order by p.display_name) from public.person p where exists(select 1 from public.membership m where m.person_id=p.id and m.organisation_id=o.id and m.role='member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())) or exists(select 1 from public.group_txn t where t.member_id=p.id and t.organisation_id=o.id)),'[]'::jsonb),
 'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'member_id',t.member_id,'meeting_date',m.meeting_date,'recorded_at',t.recorded_at,'shares',t.shares::text,'amount',t.amount::text,'currency',t.currency,'journal_id',t.journal_id,'calculation_mismatch',t.calculation_mismatch,'note',t.note) order by t.recorded_at desc) from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.organisation_id=o.id),'[]'::jsonb),
 'journal_lines',coalesce((select jsonb_agg(jsonb_build_object('journal_id',l.journal_id,'account',a.code,'side',l.side,'amount',l.amount::text)) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=o.id),'[]'::jsonb)) into data
 from public.organisation o join public.currency_reference cr on cr.code=o.currency join public.group_settings gs on gs.organisation_id=o.id where o.id=p_org and o.type='group' and o.status='active';
 return data;
end $$;
