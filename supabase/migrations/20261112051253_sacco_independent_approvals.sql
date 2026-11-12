grant usage on schema auth,extensions to yapesa_sacco;
grant execute on function auth.jwt(),extensions.digest(text,text) to yapesa_sacco;
-- Approval evidence only: Fineract remains the sole SACCO money engine.
create function private.sacco_review_actor(p_org uuid,p_person uuid,p_user text,p_version uuid,p_manager boolean,p_session uuid default null) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.person a join auth.users u on u.id=a.auth_user_id where a.id=p_person and u.phone_confirmed_at is not null and exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.factor_type='totp' and f.status::text='verified') and (p_session is null or exists(select 1 from auth.sessions sess join auth.mfa_factors f on f.id=sess.factor_id and f.user_id=sess.user_id and f.status::text='verified' where sess.id=p_session and sess.user_id=u.id and sess.aal::text='aal2' and (sess.not_after is null or sess.not_after>now())))) and not exists(select 1 from private.mfa_recovery r where r.person_id=p_person and exists(select 1 from private.mfa_recovery_event e where e.recovery_id=r.id and e.phase='prepared') and not exists(select 1 from private.mfa_recovery_event e where e.recovery_id=r.id and e.phase='recovered')) and exists(select 1 from public.organisation o join private.sacco_connection c on c.organisation_id=o.id join public.membership m on m.organisation_id=o.id join private.fineract_identity i on i.organisation_id=o.id and i.person_id=m.person_id join private.fineract_link l on l.organisation_id=o.id and l.person_id=m.person_id where o.id=p_org and o.status='active' and o.type='sacco' and m.person_id=p_person and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()) and m.role=any(case when p_manager then array['manager'] else array['manager','accountant','loan_officer','teller','field_officer'] end) and i.fineract_user_id=p_user and l.fineract_user_id=p_user and l.username=i.username and c.version=p_version and l.connection_version=c.version);
$$;
revoke all on function private.sacco_review_actor(uuid,uuid,text,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function private.sacco_review_actor(uuid,uuid,text,uuid,boolean,uuid) to yapesa_sacco;
create table private.sacco_proposal(
 id uuid primary key,organisation_id uuid not null references private.sacco_connection(organisation_id),actor_id uuid not null references public.person(id),engine_user text not null,connection_version uuid not null,operation text not null check(operation in ('share.apply','share.approve','share.activate','share.purchase','share.redeem','dividend.declare','dividend.approve')),payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=16000),review_hash text not null,recorded_at timestamptz not null default now()
);
create table private.sacco_decision(proposal_id uuid primary key references private.sacco_proposal(id),actor_id uuid not null references public.person(id),engine_user text not null,approved boolean not null,session_id uuid not null,recorded_at timestamptz not null default now());
create table private.sacco_dispatch(proposal_id uuid primary key references private.sacco_proposal(id),recorded_at timestamptz not null default now());
create table private.sacco_dispatch_result(proposal_id uuid primary key references private.sacco_dispatch(proposal_id),status text not null check(status in ('succeeded','rejected','uncertain')),result jsonb not null,recorded_at timestamptz not null default now());
do $$declare t text;begin foreach t in array array['sacco_proposal','sacco_decision','sacco_dispatch','sacco_dispatch_result'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated',t);
 execute format('grant select,insert on private.%I to yapesa_sacco',t);
 execute format('create trigger immutable_record before update or delete on private.%I for each row execute function private.immutable_record()',t);
 end loop;end $$;
create index on private.sacco_proposal(organisation_id,recorded_at);
create policy proposal_scope on private.sacco_proposal for select to yapesa_sacco using(private.sacco_staff(organisation_id) and (actor_id=private.current_person() or private.has_role(organisation_id,array['manager'])));
create policy proposal_insert on private.sacco_proposal for insert to yapesa_sacco with check(private.sacco_staff(organisation_id) and actor_id=private.current_person());
create policy decision_scope on private.sacco_decision for select to yapesa_sacco using(exists(select 1 from private.sacco_proposal p where p.id=proposal_id));
create policy decision_insert on private.sacco_decision for insert to yapesa_sacco with check(actor_id=private.current_person() and exists(select 1 from private.sacco_proposal p where p.id=proposal_id and p.actor_id<>sacco_decision.actor_id and private.has_role(p.organisation_id,array['manager'])));
create policy dispatch_scope on private.sacco_dispatch for select to yapesa_sacco using(exists(select 1 from private.sacco_proposal p where p.id=proposal_id));
create policy dispatch_insert on private.sacco_dispatch for insert to yapesa_sacco with check(exists(select 1 from private.sacco_proposal p where p.id=proposal_id and p.actor_id=private.current_person()));
create policy dispatch_result_scope on private.sacco_dispatch_result for select to yapesa_sacco using(exists(select 1 from private.sacco_proposal p where p.id=proposal_id));
create policy dispatch_result_insert on private.sacco_dispatch_result for insert to yapesa_sacco with check(exists(select 1 from private.sacco_proposal p where p.id=proposal_id and p.actor_id=private.current_person()));
grant create on schema private to yapesa_sacco;
create function private.sacco_review(p_org uuid,p_action text,p_id uuid,p_user text,p_payload jsonb default null,p_hash text default null,p_approved boolean default null,p_status text default null,p_result jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.sacco_proposal;d private.sacco_decision;r private.sacco_dispatch_result;v uuid;h text;begin
 if not private.gateway_allowed() or not private.sacco_staff(p_org) then raise exception 'Verified SACCO staff required' using errcode='42501';end if;
 select version into strict v from private.sacco_connection where organisation_id=p_org;
 if not private.sacco_review_actor(p_org,private.current_person(),p_user,v,false) then raise exception 'Current linked identity required' using errcode='42501';end if;
 if p_action='list' then
 return coalesce((select jsonb_agg(jsonb_build_object('id',p0.id,'name',p0.actor_id,'operation',p0.operation,'date',p0.recorded_at,'values',p0.payload,'review_hash',p0.review_hash,'status',coalesce(r0.status,case when x0.proposal_id is not null then 'reconciliation_required' when d0.approved then 'approved' when d0.approved=false then 'rejected' else 'awaiting_approval' end),'can_check',d0.proposal_id is null and p0.actor_id<>private.current_person() and p0.engine_user<>p_user and private.has_role(p_org,array['manager']),'can_execute',p0.actor_id=private.current_person() and d0.approved and d0.recorded_at>now()-interval '10 minutes' and x0.proposal_id is null) order by p0.recorded_at) from private.sacco_proposal p0 left join private.sacco_decision d0 on d0.proposal_id=p0.id left join private.sacco_dispatch x0 on x0.proposal_id=p0.id left join private.sacco_dispatch_result r0 on r0.proposal_id=p0.id where p0.organisation_id=p_org),'[]'::jsonb);end if;
 if p_id is null then raise exception 'Reference required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,57));
 select * into p from private.sacco_proposal where id=p_id and organisation_id=p_org;
 if p_action='submit' then
 if jsonb_typeof(p_payload)<>'object' or p_payload->>'operation' not in ('share.apply','share.approve','share.activate','share.purchase','share.redeem','dividend.declare','dividend.approve') then raise exception 'Unsupported independent approval' using errcode='22023';end if;
 h:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 if p.id is not null then
 if p.actor_id<>private.current_person() or p.engine_user<>p_user or p.connection_version<>v or p.payload<>p_payload then raise exception 'Proposal reference conflict' using errcode='23505';end if;
 else
 insert into private.sacco_proposal values(p_id,p_org,private.current_person(),p_user,v,p_payload->>'operation',p_payload,h,now());
 insert into public.audit_log(organisation_id,actor_id,action,record_id,after_value) values(p_org,private.current_person(),'sacco_proposal',p_id,jsonb_build_object('review_hash',h,'operation',p_payload->>'operation','engine_user',p_user));
 end if;
 return jsonb_build_object('id',p_id,'status','awaiting_approval','result',jsonb_build_object('review_hash',h));end if;
 if p.id is null or p.review_hash is distinct from p_hash or p.connection_version<>v then raise exception 'Review changed or unavailable' using errcode='23505';end if;
 if not private.sacco_review_actor(p_org,p.actor_id,p.engine_user,v,false) then raise exception 'Maker no longer eligible' using errcode='42501';end if;
 select * into d from private.sacco_decision where proposal_id=p.id;
 if p_action='decide' then
 if p_approved is null or p.actor_id=private.current_person() or p.engine_user=p_user or not private.has_role(p_org,array['manager']) then raise exception 'Independent manager required' using errcode='42501';end if;
 if d.proposal_id is not null then
 if d.actor_id<>private.current_person() or d.engine_user<>p_user or d.approved<>p_approved then raise exception 'Already decided' using errcode='23505';end if;
 else
 insert into private.sacco_decision values(p.id,private.current_person(),p_user,p_approved,(auth.jwt()->>'session_id')::uuid,now());
 insert into public.audit_log(organisation_id,actor_id,action,record_id,after_value) values(p_org,private.current_person(),'sacco_decision',p.id,jsonb_build_object('approved',p_approved,'review_hash',p.review_hash,'maker',p.actor_id,'engine_user',p_user));end if;
 return jsonb_build_object('id',p.id,'status',case when p_approved then 'approved' else 'rejected' end,'result','{}'::jsonb);end if;
 if p.actor_id<>private.current_person() or p.engine_user<>p_user then raise exception 'Original maker required' using errcode='42501';end if;
 if p_action='claim' then
 select * into r from private.sacco_dispatch_result where proposal_id=p.id;
 if found then return jsonb_build_object('id',p.id,'status',r.status,'result',r.result);end if;
 if d.approved is distinct from true or d.recorded_at<=now()-interval '10 minutes' or not private.sacco_review_actor(p_org,d.actor_id,d.engine_user,v,true,d.session_id) then raise exception 'Fresh independent approval required' using errcode='42501';end if;
 if exists(select 1 from private.sacco_dispatch where proposal_id=p.id) then raise exception 'Execution requires reconciliation' using errcode='23505';end if;
 insert into private.sacco_dispatch values(p.id,now());
 insert into public.audit_log(organisation_id,actor_id,action,record_id,after_value) values(p_org,private.current_person(),'sacco_dispatch',p.id,jsonb_build_object('review_hash',p.review_hash,'approver',d.actor_id));
 return jsonb_build_object('id',p.id,'status','claimed','payload',p.payload);end if;
 if p_action='finish' then
 if p_status not in ('succeeded','rejected','uncertain') or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>2000 or exists(select 1 from jsonb_object_keys(p_result) k where k not in ('command_id','resource_id','sub_resource_id','status','error','body_hash')) then raise exception 'Invalid result' using errcode='22023';end if;
 insert into private.sacco_dispatch_result values(p.id,p_status,p_result,now());
 return jsonb_build_object('id',p.id,'status',p_status,'result',p_result);end if;
 raise exception 'Unsupported review action' using errcode='22023';end $$;
alter function private.sacco_review(uuid,text,uuid,text,jsonb,text,boolean,text,jsonb) owner to yapesa_sacco;
revoke create on schema private from yapesa_sacco;
create function public.sacco_review(p_org uuid,p_action text,p_id uuid,p_user text,p_payload jsonb default null,p_hash text default null,p_approved boolean default null,p_status text default null,p_result jsonb default null) returns jsonb language sql security invoker set search_path='' as $$select private.sacco_review(p_org,p_action,p_id,p_user,p_payload,p_hash,p_approved,p_status,p_result)$$;
revoke all on function private.sacco_review(uuid,text,uuid,text,jsonb,text,boolean,text,jsonb),public.sacco_review(uuid,text,uuid,text,jsonb,text,boolean,text,jsonb) from public,anon;
grant execute on function private.sacco_review(uuid,text,uuid,text,jsonb,text,boolean,text,jsonb),public.sacco_review(uuid,text,uuid,text,jsonb,text,boolean,text,jsonb) to authenticated;
