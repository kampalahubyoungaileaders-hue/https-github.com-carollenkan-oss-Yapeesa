-- SACCO integration metadata only. Fineract alone owns accounts, balances and journals.
do $$begin if not exists(select 1 from pg_roles where rolname='yapesa_sacco') then create role yapesa_sacco nologin noinherit nobypassrls;end if;end $$;
grant yapesa_sacco to postgres;
grant usage on schema public,private to yapesa_sacco;
create function private.sacco_staff(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.session_active(true) and exists(select 1 from public.organisation o where o.id=p_org and o.type='sacco' and o.status='active') and private.has_role(p_org,array['manager','accountant','loan_officer','teller','field_officer']);
$$;
revoke all on function private.sacco_staff(uuid) from public,anon;
grant execute on function private.sacco_staff(uuid) to authenticated,yapesa_sacco,yapesa_administrator;
create table private.sacco_connection(
 organisation_id uuid primary key references public.organisation(id),instance_key text not null check(instance_key ~ '^[a-z][a-z0-9_-]{0,62}$'),tenant_id text not null check(tenant_id ~ '^[a-z][a-z0-9_-]{0,62}$'),
 endpoint_hash text not null check(endpoint_hash ~ '^[a-f0-9]{64}$'),version uuid not null default gen_random_uuid(),created_by uuid not null references public.person(id),recorded_at timestamptz not null default now(),unique(instance_key,tenant_id)
);
create table private.fineract_identity(
 organisation_id uuid not null references private.sacco_connection(organisation_id),person_id uuid not null references public.person(id),fineract_user_id text not null check(fineract_user_id ~ '^[1-9][0-9]{0,18}$'),username text not null check(length(username) between 1 and 100),primary key(organisation_id,person_id),unique(organisation_id,fineract_user_id),unique(organisation_id,username)
);
create index on private.fineract_identity(person_id);
alter table private.fineract_identity enable row level security;
revoke all on private.fineract_identity from public,anon,authenticated;
grant select on private.fineract_identity to yapesa_sacco,yapesa_administrator;
grant insert,update on private.fineract_identity to yapesa_administrator;
create policy sacco_own_identity on private.fineract_identity for select to yapesa_sacco using(private.sacco_staff(organisation_id) and person_id=private.current_person());
create policy sacco_admin_identity on private.fineract_identity for all to yapesa_administrator using(private.is_platform_admin()) with check(private.is_platform_admin());
create table private.fineract_link(
 organisation_id uuid not null references private.sacco_connection(organisation_id),person_id uuid not null references public.person(id),fineract_user_id text not null check(fineract_user_id ~ '^[1-9][0-9]{0,18}$'),username text not null check(length(username) between 1 and 100),
 credential text not null check(length(credential) between 40 and 4000),connection_version uuid not null,recorded_at timestamptz not null default now(),primary key(organisation_id,person_id),unique(organisation_id,fineract_user_id)
);
create index on private.fineract_link(person_id);
create index on private.sacco_connection(created_by);
create table private.fineract_command(
 request_id uuid primary key,organisation_id uuid not null references private.sacco_connection(organisation_id),actor_id uuid not null references public.person(id),fineract_user_id text not null,operation text not null check(length(operation) between 1 and 100),payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),recorded_at timestamptz not null default now()
);
create index on private.fineract_command(organisation_id,recorded_at desc);
create index on private.fineract_command(actor_id);
create table private.fineract_command_result(
 id bigint generated always as identity primary key,request_id uuid not null references private.fineract_command(request_id),status text not null check(status in ('succeeded','rejected','uncertain')),result jsonb not null check(jsonb_typeof(result)='object'),recorded_at timestamptz not null default now()
);
create index on private.fineract_command_result(request_id,id desc);
do $$declare t text;begin foreach t in array array['sacco_connection','fineract_link','fineract_command','fineract_command_result'] loop
 execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;end $$;
grant select on private.sacco_connection to yapesa_sacco,yapesa_administrator;
grant insert on private.sacco_connection to yapesa_administrator;
grant select,insert,update,delete on private.fineract_link to yapesa_sacco;
grant select,insert on private.fineract_command,private.fineract_command_result to yapesa_sacco;
grant usage on sequence private.fineract_command_result_id_seq to yapesa_sacco;
create policy sacco_connections on private.sacco_connection for select to yapesa_sacco using(private.sacco_staff(organisation_id) or private.is_platform_admin());
create policy sacco_admin_connections on private.sacco_connection for all to yapesa_administrator using(private.is_platform_admin()) with check(private.is_platform_admin());
create policy sacco_own_link on private.fineract_link for all to yapesa_sacco using(private.sacco_staff(organisation_id) and person_id=private.current_person()) with check(private.sacco_staff(organisation_id) and person_id=private.current_person());
create policy sacco_own_command on private.fineract_command for all to yapesa_sacco using(private.sacco_staff(organisation_id) and actor_id=private.current_person()) with check(private.sacco_staff(organisation_id) and actor_id=private.current_person());
create policy sacco_own_result on private.fineract_command_result for all to yapesa_sacco using(exists(select 1 from private.fineract_command c where c.request_id=fineract_command_result.request_id)) with check(exists(select 1 from private.fineract_command c where c.request_id=fineract_command_result.request_id));
create trigger immutable_record before update or delete on private.sacco_connection for each row execute function private.immutable_record();
create trigger immutable_record before update or delete on private.fineract_command for each row execute function private.immutable_record();
create trigger immutable_record before update or delete on private.fineract_command_result for each row execute function private.immutable_record();
grant select on public.organisation,public.person,public.membership to yapesa_sacco;
grant insert on public.audit_log to yapesa_sacco;
create policy sacco_org_read on public.organisation for select to authenticated,yapesa_sacco using(private.sacco_staff(id) or private.is_platform_admin());
create policy sacco_person_read on public.person for select to yapesa_sacco using(id=private.current_person());
create policy sacco_membership_read on public.membership for select to yapesa_sacco using(person_id=private.current_person() and private.sacco_staff(organisation_id));
create policy sacco_audit on public.audit_log for insert to yapesa_sacco with check(private.sacco_staff(organisation_id) and actor_id=private.current_person());
grant execute on function private.session_active(boolean),private.current_person(),private.has_role(uuid,text[]),private.is_platform_admin(),private.gateway_allowed() to yapesa_sacco;
grant execute on function private.gateway_allowed() to yapesa_administrator;
create function private.sacco_list() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not private.session_active(false) then raise exception 'Sign in required' using errcode='42501';end if;
 if not private.session_active(true) then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'currency',o.currency,'time_zone',o.time_zone,'instance_key',c.instance_key,'tenant_id',c.tenant_id,'can_work',private.sacco_staff(o.id)) order by o.name,o.id) from public.organisation o join private.sacco_connection c on c.organisation_id=o.id where o.type='sacco' and (private.sacco_staff(o.id) or private.is_platform_admin())),'[]'::jsonb);
end $$;
create function private.sacco_context(p_org uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare c private.sacco_connection;l private.fineract_link;begin
 if not private.gateway_allowed() or not private.sacco_staff(p_org) then raise exception 'SACCO staff required' using errcode='42501';end if;
 select * into strict c from private.sacco_connection where organisation_id=p_org;
 select lnk.* into l from private.fineract_link lnk where lnk.organisation_id=p_org and lnk.person_id=private.current_person() and lnk.connection_version=c.version and exists(select 1 from private.fineract_identity i where i.organisation_id=p_org and i.person_id=private.current_person() and i.fineract_user_id=lnk.fineract_user_id and i.username=lnk.username);
 return jsonb_build_object('person_id',private.current_person(),'instance_key',c.instance_key,'tenant_id',c.tenant_id,'version',c.version,'endpoint_hash',c.endpoint_hash,'expected_identity',(select jsonb_build_object('user_id',fineract_user_id,'username',username) from private.fineract_identity where organisation_id=p_org and person_id=private.current_person()),'roles',(select jsonb_agg(role order by role) from public.membership where person_id=private.current_person() and organisation_id=p_org and starts_at<=now() and (ends_at is null or ends_at>now())),'link',case when l.person_id is null then null else jsonb_build_object('user_id',l.fineract_user_id,'username',l.username,'credential',l.credential) end);
end $$;
create function private.sacco_link(p_org uuid,p_user text,p_username text,p_credential text,p_version uuid,p_device uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare c private.sacco_connection;begin
 if not private.gateway_allowed() or not private.sacco_staff(p_org) then raise exception 'SACCO staff required' using errcode='42501';end if;
 select * into strict c from private.sacco_connection where organisation_id=p_org;
 if not exists(select 1 from private.fineract_identity where organisation_id=p_org and person_id=private.current_person() and fineract_user_id=p_user and username=p_username) then raise exception 'Assigned Fineract staff identity required' using errcode='42501';end if;
 if c.version<>p_version then raise exception 'Connection changed' using errcode='23505';end if;
 insert into private.fineract_link(organisation_id,person_id,fineract_user_id,username,credential,connection_version) values(p_org,private.current_person(),p_user,p_username,p_credential,p_version) on conflict(organisation_id,person_id) do update set fineract_user_id=excluded.fineract_user_id,username=excluded.username,credential=excluded.credential,connection_version=excluded.connection_version,recorded_at=now();
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(p_org,private.current_person(),p_device,'link_fineract_staff',private.current_person(),jsonb_build_object('fineract_user_id',p_user,'connection_version',p_version));
 return jsonb_build_object('id',private.current_person());
end $$;
create function private.sacco_unlink(p_org uuid,p_device uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not private.gateway_allowed() or not private.sacco_staff(p_org) then raise exception 'SACCO staff required' using errcode='42501';end if;
 delete from private.fineract_link where organisation_id=p_org and person_id=private.current_person();
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(p_org,private.current_person(),p_device,'unlink_fineract_staff',private.current_person(),'{}'::jsonb);
 return jsonb_build_object('id',private.current_person());
end $$;
create function private.sacco_prepare(p_org uuid,p_request uuid,p_operation text,p_hash text,p_user text) returns jsonb language plpgsql security definer set search_path='' as $$declare c private.fineract_command;r private.fineract_command_result;begin
 if not private.gateway_allowed() or not private.sacco_staff(p_org) or not exists(select 1 from private.fineract_link l join private.fineract_identity i using(organisation_id,person_id) where l.organisation_id=p_org and l.person_id=private.current_person() and l.fineract_user_id=p_user and i.fineract_user_id=p_user and i.username=l.username) then raise exception 'Linked staff required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,41));
 select * into c from private.fineract_command where request_id=p_request;
 if found then
  if c.organisation_id<>p_org or c.actor_id<>private.current_person() or c.operation<>p_operation or c.payload_hash<>p_hash or c.fineract_user_id<>p_user then raise exception 'Request reference conflict' using errcode='23505';end if;
  select * into r from private.fineract_command_result where request_id=p_request order by id desc limit 1;
  return jsonb_build_object('status',coalesce(r.status,'pending'),'result',coalesce(r.result,'{}'::jsonb));
 end if;
 insert into private.fineract_command values(p_request,p_org,private.current_person(),p_user,p_operation,p_hash,now());
 return jsonb_build_object('status','new','result','{}'::jsonb);
end $$;
create function private.sacco_finish(p_org uuid,p_request uuid,p_status text,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not private.gateway_allowed() or not private.sacco_staff(p_org) or not exists(select 1 from private.fineract_command where request_id=p_request and organisation_id=p_org and actor_id=private.current_person()) then raise exception 'Not permitted' using errcode='42501';end if;
 if p_status not in ('succeeded','rejected','uncertain') or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>2000 or exists(select 1 from jsonb_object_keys(p_result) k where k not in ('command_id','resource_id','sub_resource_id','status','error','body_hash')) then raise exception 'Invalid result metadata' using errcode='22023';end if;
 insert into private.fineract_command_result(request_id,status,result) values(p_request,p_status,p_result);
 return jsonb_build_object('id',p_request,'status',p_status,'result',p_result);
end $$;
create function private.sacco_admin(p_request uuid,p_device uuid,p_action text,p_org uuid,p_name text,p_country text,p_currency text,p_zone text,p_instance text,p_tenant text,p_person uuid,p_role text,p_enabled boolean,p_reason text,p_endpoint_hash text) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;payload jsonb;target uuid:=p_org;begin
 if not private.gateway_allowed() or not private.is_platform_admin() then raise exception 'Verified administrator required' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Reason required' using errcode='22023';end if;
 payload:=jsonb_build_object('action',p_action,'org',p_org,'name',p_name,'country',p_country,'currency',p_currency,'zone',p_zone,'instance',p_instance,'tenant',p_tenant,'person',p_person,'role',p_role,'enabled',p_enabled,'reason',p_reason,'endpoint_hash',p_endpoint_hash);
 result:=private.admin_begin(p_request,'sacco_setup',payload);if result is not null then return result;end if;
 if p_action='create' then
  if p_org is not null or length(btrim(p_name)) not between 1 and 200 or p_country !~ '^[A-Z]{2}$' or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone) then raise exception 'Invalid SACCO settings' using errcode='22023';end if;
  insert into public.organisation(name,type,country_code,currency,time_zone) values(btrim(p_name),'sacco',p_country,p_currency,p_zone) returning id into target;
  insert into private.sacco_connection(organisation_id,instance_key,tenant_id,created_by,endpoint_hash) values(target,p_instance,p_tenant,private.current_person(),p_endpoint_hash);
 elsif p_action='role' then
  if not exists(select 1 from public.organisation where id=p_org and type='sacco' and status='active') or p_role not in ('manager','accountant','loan_officer','teller','field_officer') or p_enabled is null then raise exception 'Invalid SACCO role' using errcode='22023';end if;
  if p_enabled then
   if not private.staff_ready(p_person) then raise exception 'Staff phone and authenticator must be verified' using errcode='22023';end if;
   insert into public.membership(person_id,organisation_id,role) values(p_person,p_org,p_role) on conflict(person_id,organisation_id,role) do update set starts_at=now(),ends_at=null;
  else update public.membership set ends_at=greatest(clock_timestamp(),starts_at+interval '1 microsecond') where person_id=p_person and organisation_id=p_org and role=p_role and (ends_at is null or ends_at>now());end if;
 else raise exception 'Invalid SACCO setup action' using errcode='22023';end if;
 return private.admin_finish(p_request,'sacco_setup',payload,jsonb_build_object('id',target),target,p_device,coalesce(p_person,target));
end $$;
grant create on schema private to yapesa_sacco,yapesa_administrator;
-- Bounded executors receive no access to Groups journals, Auth secrets or Fineract financial tables.
alter function private.sacco_list() owner to yapesa_sacco;
alter function private.sacco_context(uuid) owner to yapesa_sacco;
alter function private.sacco_link(uuid,text,text,text,uuid,uuid) owner to yapesa_sacco;
alter function private.sacco_unlink(uuid,uuid) owner to yapesa_sacco;
alter function private.sacco_prepare(uuid,uuid,text,text,text) owner to yapesa_sacco;
alter function private.sacco_finish(uuid,uuid,text,jsonb) owner to yapesa_sacco;
alter function private.sacco_admin(uuid,uuid,text,uuid,text,text,text,text,text,text,uuid,text,boolean,text,text) owner to yapesa_administrator;
revoke create on schema private from yapesa_sacco,yapesa_administrator;
create function public.sacco_list() returns jsonb language sql security invoker set search_path='' as $$select private.sacco_list()$$;
create function public.sacco_context(p_org uuid) returns jsonb language sql security invoker set search_path='' as $$select private.sacco_context(p_org)$$;
create function public.sacco_link(p_org uuid,p_user text,p_username text,p_credential text,p_version uuid,p_device uuid) returns jsonb language sql security invoker set search_path='' as $$select private.sacco_link(p_org,p_user,p_username,p_credential,p_version,p_device)$$;
create function public.sacco_unlink(p_org uuid,p_device uuid) returns jsonb language sql security invoker set search_path='' as $$select private.sacco_unlink(p_org,p_device)$$;
create function public.sacco_prepare(p_org uuid,p_request uuid,p_operation text,p_hash text,p_user text) returns jsonb language sql security invoker set search_path='' as $$select private.sacco_prepare(p_org,p_request,p_operation,p_hash,p_user)$$;
create function public.sacco_finish(p_org uuid,p_request uuid,p_status text,p_result jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.sacco_finish(p_org,p_request,p_status,p_result)$$;
create function public.sacco_admin(p_request uuid,p_device uuid,p_action text,p_org uuid,p_name text,p_country text,p_currency text,p_zone text,p_instance text,p_tenant text,p_person uuid,p_role text,p_enabled boolean,p_reason text,p_endpoint_hash text) returns jsonb language sql security invoker set search_path='' as $$select private.sacco_admin(p_request,p_device,p_action,p_org,p_name,p_country,p_currency,p_zone,p_instance,p_tenant,p_person,p_role,p_enabled,p_reason,p_endpoint_hash)$$;
do $$declare n text;begin for n in select p.oid::regprocedure::text from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname in ('public','private') and p.proname in ('sacco_list','sacco_context','sacco_link','sacco_unlink','sacco_prepare','sacco_finish','sacco_admin') loop
 execute 'revoke all on function '||n||' from public,anon,authenticated';execute 'grant execute on function '||n||' to authenticated';
 end loop;end $$;
-- Platform setup can inspect identity mappings, never credential ciphertext.
grant select(organisation_id,person_id,fineract_user_id,username,recorded_at) on private.fineract_link to yapesa_administrator;
create policy sacco_admin_link_metadata on private.fineract_link for select to yapesa_administrator using(private.is_platform_admin());
grant create on schema private to yapesa_administrator;
create function private.sacco_administration() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not private.gateway_allowed() or not private.is_platform_admin() then raise exception 'Verified administrator required' using errcode='42501';end if;
 return jsonb_build_object('staff',coalesce((select jsonb_agg(jsonb_build_object('organisation_id',m.organisation_id,'person_id',m.person_id,'name',p.display_name,'role',m.role,'engine_username',l.username,'engine_user_id',l.fineract_user_id) order by o.name,p.display_name,m.role) from public.membership m join public.organisation o on o.id=m.organisation_id and o.type='sacco' join public.person p on p.id=m.person_id left join private.fineract_link l on l.organisation_id=m.organisation_id and l.person_id=m.person_id where m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())),'[]'::jsonb));
end $$;
alter function private.sacco_administration() owner to yapesa_administrator;
revoke create on schema private from yapesa_administrator;
create function public.sacco_administration() returns jsonb language sql security invoker set search_path='' as $$select private.sacco_administration()$$;
revoke all on function private.sacco_administration(),public.sacco_administration() from public,anon,authenticated;
grant execute on function private.sacco_administration(),public.sacco_administration() to authenticated;
-- Only references/hashes for this SACCO's supported pending commands are disclosed.
create function private.sacco_approval_scope(p_org uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not private.gateway_allowed() or not private.sacco_staff(p_org) or not private.has_role(p_org,array['manager']) then raise exception 'SACCO checker required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('command_id',r.result->>'command_id','body_hash',r.result->>'body_hash','operation',c.operation,'actor_id',c.actor_id,'actor_name',p.display_name,'fineract_user_id',c.fineract_user_id)) from private.fineract_command c join public.person p on p.id=c.actor_id cross join lateral(select result from private.fineract_command_result where request_id=c.request_id and status='succeeded' order by id desc limit 1) r where c.organisation_id=p_org and c.operation not like 'checker.%' and r.result ? 'command_id' and r.result ? 'body_hash'),'[]'::jsonb);
end $$;
create function public.sacco_approval_scope(p_org uuid) returns jsonb language sql security invoker set search_path='' as $$select private.sacco_approval_scope(p_org)$$;
revoke all on function private.sacco_approval_scope(uuid),public.sacco_approval_scope(uuid) from public,anon,authenticated;
grant execute on function private.sacco_approval_scope(uuid),public.sacco_approval_scope(uuid) to authenticated;

grant create on schema private to yapesa_administrator;
create function private.sacco_assign_identity(p_request uuid,p_device uuid,p_org uuid,p_person uuid,p_user text,p_username text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$declare payload jsonb;prior jsonb;old private.fineract_identity;begin
 if not private.gateway_allowed() or not private.is_platform_admin() then raise exception 'Verified administrator required' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 500 or not private.staff_ready(p_person) or not exists(select 1 from private.sacco_connection where organisation_id=p_org) then raise exception 'Verified staff and SACCO required' using errcode='22023';end if;
 payload:=jsonb_build_object('org',p_org,'person',p_person,'fineract_user_id',p_user,'username',p_username,'reason',p_reason);
 prior:=private.admin_begin(p_request,'sacco_staff_identity',payload);if prior is not null then return prior;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||p_person::text,42));
 select * into old from private.fineract_identity where organisation_id=p_org and person_id=p_person;
 if found and (old.fineract_user_id<>p_user or old.username<>p_username) and exists(select 1 from public.membership where organisation_id=p_org and person_id=p_person and role in ('manager','accountant','loan_officer','teller','field_officer') and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'Revoke staff access before changing the accounting identity' using errcode='22023';end if;
 insert into private.fineract_identity values(p_org,p_person,p_user,p_username) on conflict(organisation_id,person_id) do update set fineract_user_id=excluded.fineract_user_id,username=excluded.username;
 return private.admin_finish(p_request,'sacco_staff_identity',payload,jsonb_build_object('id',p_person),p_org,p_device,p_person);
end $$;
alter function private.sacco_assign_identity(uuid,uuid,uuid,uuid,text,text,text) owner to yapesa_administrator;
revoke create on schema private from yapesa_administrator;
create function public.sacco_assign_identity(p_request uuid,p_device uuid,p_org uuid,p_person uuid,p_user text,p_username text,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select private.sacco_assign_identity(p_request,p_device,p_org,p_person,p_user,p_username,p_reason)$$;
revoke all on function private.sacco_assign_identity(uuid,uuid,uuid,uuid,text,text,text),public.sacco_assign_identity(uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function private.sacco_assign_identity(uuid,uuid,uuid,uuid,text,text,text),public.sacco_assign_identity(uuid,uuid,uuid,uuid,text,text,text) to authenticated;
