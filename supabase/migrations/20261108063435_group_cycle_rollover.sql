-- A new cycle carries remaining Social cash, never the pre-payout closing count.
create table public.cycle_opening(
 cycle_id uuid primary key, organisation_id uuid not null references public.organisation(id),
 previous_cycle_id uuid not null, finalization_id uuid not null unique references public.shareout_finalization(id),
 opening_cash bigint not null check(opening_cash>=0), social_reserve bigint not null check(social_reserve>=0 and social_reserve=opening_cash),
 entered_by uuid not null references public.person(id), recorded_at timestamptz not null default now(),
 calc_version text not null check(calc_version='groups-cycle-opening-v1'),
 foreign key(cycle_id,organisation_id) references public.cycle(id,organisation_id),
 foreign key(previous_cycle_id,organisation_id) references public.cycle(id,organisation_id),check(cycle_id<>previous_cycle_id)
);
alter table public.cycle_opening enable row level security;
revoke all on public.cycle_opening from public,anon,authenticated;
grant select on public.cycle_opening to authenticated,yapesa_administrator,yapesa_meetings;
grant insert on public.cycle_opening to yapesa_administrator;
create policy cycle_opening_read on public.cycle_opening for select to authenticated,yapesa_meetings using(private.is_officer(organisation_id));
create policy cycle_opening_admin_read on public.cycle_opening for select to yapesa_administrator using(private.is_platform_admin());
create policy cycle_opening_admin_insert on public.cycle_opening for insert to yapesa_administrator with check(private.is_platform_admin());
create trigger immutable_record before update or delete on public.cycle_opening for each row execute function private.immutable_record();
create index on public.cycle_opening(organisation_id);
create index on public.cycle_opening(previous_cycle_id);
create index on public.cycle_opening(entered_by);
grant select on public.shareout_plan,public.shareout_commit,public.shareout_finalization,public.meeting,public.journal_line to yapesa_administrator;
do $$ declare tbl text;begin foreach tbl in array array['shareout_plan','shareout_commit','shareout_finalization','meeting','journal_line'] loop execute format('create policy cycle_admin_read on public.%I for select to yapesa_administrator using(private.is_platform_admin())',tbl);end loop;end $$;
create function private.admin_cycle_state(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare previous public.cycle; finalization uuid; cash numeric; social numeric; unsettled numeric; earliest date;begin
 if not private.is_platform_admin() then raise exception 'Not permitted' using errcode='42501';end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Active group required' using errcode='22023';end if;
 select * into previous from public.cycle where organisation_id=p_org order by starts_on desc,id desc limit 1;
 if previous.id is null or previous.status<>'closed' or exists(select 1 from public.cycle where organisation_id=p_org and status='active') then return null;end if;
 select f.id into finalization from public.shareout_finalization f join public.shareout_commit c on c.plan_id=f.plan_id where c.cycle_id=previous.id and f.organisation_id=p_org;
 if finalization is null or exists(select 1 from public.cycle_opening where finalization_id=finalization) or exists(select 1 from public.meeting where organisation_id=p_org and status<>'closed') then return null;end if;
 select coalesce(sum(w.balance) filter(where w.code='cash'),0),-coalesce(sum(w.balance) filter(where w.code='social_fund'),0),coalesce(sum(abs(w.balance)) filter(where w.code not in ('cash','social_fund')),0)
 into cash,social,unsettled from (select a.code,sum(case when l.side='debit' then l.amount else -l.amount end) balance from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=p_org group by a.code) w;
 if cash<0 or cash>9223372036854775807 or cash<>social or unsettled<>0 then return null;end if;
 select greatest(previous.starts_on,coalesce(max(meeting_date),previous.starts_on))+1 into earliest from public.meeting where organisation_id=p_org;
 return jsonb_build_object('previous_cycle_id',previous.id,'finalization_id',finalization,'earliest_start',earliest,'cash',cash::text,'social',social::text);
end $$;
revoke all on function private.admin_cycle_state(uuid) from public,anon,authenticated;
grant execute on function private.admin_cycle_state(uuid) to yapesa_administrator;
create function private.admin_start_cycle(p_request uuid,p_device uuid,p_org uuid,p_starts date,p_ends date,p_price text) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; prior jsonb; state jsonb; cycle_id uuid:=gen_random_uuid();begin
 payload:=jsonb_build_object('device_id',p_device,'organisation_id',p_org,'starts_on',p_starts,'ends_on',p_ends,'share_price',p_price);
 prior:=private.admin_begin(p_request,'start_group_cycle',payload);if prior is not null then return prior;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not private.is_platform_admin() then raise exception 'Not permitted' using errcode='42501';end if;
 if p_request::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or p_device is null or p_starts is null or p_ends is null or p_ends<p_starts or p_price is null or p_price !~ '^[1-9][0-9]{0,18}$' or p_price::numeric>9223372036854775807 then raise exception 'Explicit cycle dates and share price required' using errcode='22023';end if;
 state:=private.admin_cycle_state(p_org);
 if state is null or p_starts<(state->>'earliest_start')::date then raise exception 'Complete share-out and choose a later cycle start' using errcode='22023';end if;
 insert into public.cycle(id,organisation_id,starts_on,ends_on,share_price) values(cycle_id,p_org,p_starts,p_ends,p_price::bigint);
 insert into public.cycle_opening(cycle_id,organisation_id,previous_cycle_id,finalization_id,opening_cash,social_reserve,entered_by,calc_version) values(cycle_id,p_org,(state->>'previous_cycle_id')::uuid,(state->>'finalization_id')::uuid,(state->>'cash')::bigint,(state->>'social')::bigint,private.current_person(),'groups-cycle-opening-v1');
 return private.admin_finish(p_request,'start_group_cycle',payload,jsonb_build_object('id',cycle_id),p_org,p_device,cycle_id);
end $$;
grant create on schema private to yapesa_administrator;
alter function private.admin_start_cycle(uuid,uuid,uuid,date,date,text) owner to yapesa_administrator;
revoke create on schema private from yapesa_administrator;
revoke all on function private.admin_start_cycle(uuid,uuid,uuid,date,date,text) from public,anon,authenticated;
grant execute on function private.admin_start_cycle(uuid,uuid,uuid,date,date,text) to authenticated;
create function public.admin_start_cycle(p_request uuid,p_device uuid,p_org uuid,p_starts date,p_ends date,p_price text) returns jsonb language sql security invoker set search_path='' as $$select private.admin_start_cycle(p_request,p_device,p_org,p_starts,p_ends,p_price);$$;
revoke all on function public.admin_start_cycle(uuid,uuid,uuid,date,date,text) from public,anon,authenticated;
grant execute on function public.admin_start_cycle(uuid,uuid,uuid,date,date,text) to authenticated;

create or replace function private.admin_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_platform_admin() then raise exception 'Verified platform administrator required' using errcode='42501'; end if;
 return jsonb_build_object(
 'currencies',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'minor_digits',minor_digits) order by code),'[]') from public.currency_reference),
 'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name,'phone',phone,'has_login',auth_user_id is not null,'staff_ready',private.staff_ready(id)) order by display_name),'[]') from public.person),
 'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'country_code',o.country_code,'currency',o.currency,'time_zone',o.time_zone,'max_shares',gs.max_shares_per_meeting::text,
 'next_cycle',private.admin_cycle_state(o.id),'configuration_locked',exists(select 1 from public.group_txn t where t.organisation_id=o.id) or exists(select 1 from public.social_txn t where t.organisation_id=o.id) or exists(select 1 from public.fine_charge t where t.organisation_id=o.id) or exists(select 1 from public.loan_request t where t.organisation_id=o.id),
 'cycle',(select jsonb_build_object('starts_on',c.starts_on,'ends_on',c.ends_on,'share_price',c.share_price::text) from public.cycle c where c.organisation_id=o.id and c.status='active'),
 'memberships',(select coalesce(jsonb_agg(jsonb_build_object('person_id',m.person_id,'role',m.role) order by m.person_id,m.role),'[]') from public.membership m where m.organisation_id=o.id and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))) order by o.name),'[]')
 from public.organisation o join public.group_settings gs on gs.organisation_id=o.id where o.type='group' and o.status='active'));
end $$;

create or replace function private.meeting_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_date date,p_meeting uuid,p_member uuid,p_status text,p_counted text,p_explanation text,p_proposal uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; record_uuid uuid; request_data jsonb; prior public.sync_receipt; target public.meeting; cyc public.cycle; settings public.group_settings; previous public.meeting; opening numeric; snapshot jsonb; proposal public.meeting_closing; counted bigint; approvals bigint; result_data jsonb;
begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 if p_action not in ('open','attendance','propose','approve') or p_action is null or (p_action<>'approve' and not private.can_record(p_org)) then raise exception 'Not permitted' using errcode='42501'; end if;
 actor:=private.current_person();
 if p_action='approve' and not private.officer_eligible(p_org,actor) then raise exception 'Group officer role required' using errcode='42501'; end if;
 if p_request is null or p_request::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or p_device is null then raise exception 'Invalid meeting command' using errcode='22023'; end if;
 if (p_action='open' and (p_date is null or p_meeting is not null or p_member is not null or p_status is not null or p_counted is not null or p_explanation is not null or p_proposal is not null)) or
 (p_action='attendance' and (p_meeting is null or p_member is null or p_status is null or p_status not in ('present','absent','excused') or p_date is not null or p_counted is not null or p_explanation is not null or p_proposal is not null)) or
 (p_action='propose' and (p_meeting is null or p_counted is null or p_counted !~ '^(0|[1-9][0-9]{0,18})$' or p_explanation is null or length(p_explanation)>500 or p_date is not null or p_member is not null or p_status is not null or p_proposal is not null)) or
 (p_action='approve' and (p_meeting is null or p_proposal is null or p_date is not null or p_member is not null or p_status is not null or p_counted is not null or p_explanation is not null)) then raise exception 'Invalid meeting command' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 -- An administrator can change roles while this command waits for the lock.
 if not private.is_officer(p_org) or (p_action<>'approve' and not private.can_record(p_org)) or (p_action='approve' and not private.officer_eligible(p_org,actor)) then raise exception 'Meeting authority changed' using errcode='42501'; end if;

 request_data:=jsonb_build_object('action',p_action,'actor',actor,'device',p_device,'date',p_date,'meeting',p_meeting,'member',p_member,'status',p_status,'counted',p_counted,'explanation',p_explanation,'proposal',p_proposal);
 select * into prior from public.sync_receipt where client_id=p_request;
 if found then
  if prior.organisation_id<>p_org or prior.request<>request_data then raise exception 'Idempotency conflict' using errcode='23505'; end if;
  return prior.result;
 end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Inactive group' using errcode='22023'; end if;
 select * into strict settings from public.group_settings where organisation_id=p_org;
 if p_action<>'approve' and settings.writer_device_id is not null and settings.writer_device_id<>p_device then raise exception 'Writer device transfer required' using errcode='42501'; end if;
 if exists(select 1 from public.device where id=p_device and organisation_id<>p_org) then raise exception 'Invalid device' using errcode='42501'; end if;
 if not exists(select 1 from public.device where id=p_device and organisation_id=p_org) then insert into public.device(id,organisation_id,registered_by) values(p_device,p_org,actor); end if;
 if p_action<>'approve' and settings.writer_device_id is null then update public.group_settings set writer_device_id=p_device where organisation_id=p_org; end if;
 if p_action='open' then
  select * into strict cyc from public.cycle where organisation_id=p_org and status='active' and p_date between starts_on and ends_on;
  select * into target from public.meeting where cycle_id=cyc.id and meeting_date=p_date;
  if not found then insert into public.meeting(organisation_id,cycle_id,meeting_date) values(p_org,cyc.id,p_date) returning * into target; end if;
 else select * into strict target from public.meeting where id=p_meeting and organisation_id=p_org;
 end if;
 if target.status<>'open' or not exists(select 1 from public.cycle where id=target.cycle_id and status='active') then raise exception 'Meeting is closed' using errcode='22023'; end if;
 if exists(select 1 from public.meeting where organisation_id=p_org and meeting_date<target.meeting_date and status='open') then raise exception 'Earlier meeting must close first' using errcode='22023'; end if;
 if exists(select 1 from public.meeting where organisation_id=p_org and meeting_date>target.meeting_date and (status='closed' or exists(select 1 from public.meeting_session s where s.meeting_id=meeting.id))) then raise exception 'Meeting history is locked' using errcode='22023'; end if;
 if p_action='open' then
  if exists(select 1 from public.meeting_session s join public.meeting m on m.id=s.meeting_id where s.organisation_id=p_org and m.status='open' and m.id<>target.id) then raise exception 'Another meeting is open' using errcode='22023'; end if;
  if not exists(select 1 from public.meeting_session where meeting_id=target.id) then
   if exists(select 1 from public.cycle_opening where cycle_id=target.cycle_id) and not exists(select 1 from public.meeting_session s join public.meeting m on m.id=s.meeting_id where m.cycle_id=target.cycle_id) then
    select opening_cash into strict opening from public.cycle_opening where cycle_id=target.cycle_id and organisation_id=p_org;
   else
   select * into previous from public.meeting where organisation_id=p_org and meeting_date<target.meeting_date and status='closed' order by meeting_date desc,id desc limit 1;
   if found then
    select counted_cash into opening from public.meeting_closing where id=previous.closed_proposal_id;
    if opening is null then raise exception 'Previous closing needs reconciliation' using errcode='22023'; end if;
   else
    select coalesce(sum(case when l.side='debit' then l.amount else -l.amount end),0) into opening from public.journal_line l join public.ledger_account a on a.id=l.account_id join public.group_txn t on t.journal_id=l.journal_id join public.meeting m on m.id=t.meeting_id where l.organisation_id=p_org and a.code='cash' and m.meeting_date<target.meeting_date;
   end if;
   end if;
   if opening<0 or opening>9223372036854775807 then raise exception 'Invalid opening cash' using errcode='22023'; end if;
   insert into public.meeting_session(organisation_id,meeting_id,opening_cash,entered_by,device_id) values(p_org,target.id,opening::bigint,actor,p_device);
  end if;
  select id into strict record_uuid from public.meeting_session where meeting_id=target.id;
  insert into public.meeting_roster(organisation_id,meeting_id,member_id)
   select p_org,target.id,person_id from public.membership where organisation_id=p_org and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())
   union select p_org,target.id,member_id from public.group_txn where meeting_id=target.id on conflict do nothing;
 else
  if not exists(select 1 from public.meeting_session where meeting_id=target.id) then raise exception 'Open the meeting first' using errcode='22023'; end if;
  if p_action='attendance' then
   if not exists(select 1 from public.meeting_roster where meeting_id=target.id and member_id=p_member) and not exists(select 1 from public.membership where organisation_id=p_org and person_id=p_member and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'Invalid roster member' using errcode='22023'; end if;
   insert into public.meeting_roster(organisation_id,meeting_id,member_id) values(p_org,target.id,p_member) on conflict do nothing;
   insert into public.attendance(organisation_id,meeting_id,member_id,status,entered_by,device_id) values(p_org,target.id,p_member,p_status,actor,p_device) returning id into record_uuid;
  else
   snapshot:=private.meeting_snapshot(p_org,target.id);
   if exists(select 1 from jsonb_array_elements(snapshot->'roster') r where r->>'status' is null) then raise exception 'Complete attendance first' using errcode='22023'; end if;
   if p_action='propose' then
    counted:=p_counted::bigint;
    perform private.cash_reconciliation(snapshot->>'opening_cash',snapshot->>'cash_in',snapshot->>'cash_out',p_counted);
    if counted<>(snapshot->>'expected_cash')::bigint and p_explanation !~ '[^[:space:]]' then raise exception 'Explain the cash difference' using errcode='22023'; end if;
    insert into public.meeting_closing(organisation_id,meeting_id,snapshot_hash,expected_cash,counted_cash,difference,explanation,calc_version,entered_by,device_id)
    values(p_org,target.id,private.meeting_hash(snapshot),(snapshot->>'expected_cash')::bigint,counted,counted-(snapshot->>'expected_cash')::bigint,p_explanation,'groups-meetings-v1',actor,p_device) returning id into record_uuid;
   else
    select * into strict proposal from public.meeting_closing where id=p_proposal and meeting_id=target.id and organisation_id=p_org;
    if proposal.id is distinct from (select id from public.meeting_closing where meeting_id=target.id order by revision desc limit 1) or proposal.snapshot_hash<>private.meeting_hash(snapshot) then raise exception 'Closing snapshot changed' using errcode='22023'; end if;
    insert into public.meeting_approval(organisation_id,meeting_id,closing_id,officer_id,device_id) values(p_org,target.id,proposal.id,actor,p_device) returning id into record_uuid;
    select count(*) into approvals from public.meeting_approval a where closing_id=proposal.id and private.officer_eligible(p_org,a.officer_id);
    if approvals>=2 then update public.meeting set status='closed',closed_proposal_id=proposal.id where id=target.id; end if;
   end if;
  end if;
 end if;
 result_data:=jsonb_build_object('id',target.id,'record_id',record_uuid);
 insert into public.sync_receipt(client_id,organisation_id,request,result) values(p_request,p_org,request_data,result_data);
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(p_org,actor,p_device,'meeting_'||p_action,record_uuid,request_data||result_data);
 return result_data;
end $$;
