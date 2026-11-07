-- Online meeting records. No balance adjustment or payment is made by a close.
do $$ begin if not exists(select 1 from pg_roles where rolname='yapesa_meetings') then create role yapesa_meetings nologin noinherit nobypassrls; end if; end $$;
grant yapesa_meetings to postgres;
create table public.meeting_session(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), meeting_id uuid not null unique,
 opening_cash bigint not null check(opening_cash>=0), entered_by uuid not null references public.person(id), device_id uuid not null,
 recorded_at timestamptz not null default now(), foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id)
);
create table public.meeting_roster(
 organisation_id uuid not null references public.organisation(id), meeting_id uuid not null, member_id uuid not null references public.person(id),
 primary key(meeting_id,member_id), foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id)
);
create table public.attendance(
 id uuid primary key default gen_random_uuid(), revision bigint generated always as identity unique, organisation_id uuid not null references public.organisation(id), meeting_id uuid not null, member_id uuid not null,
 status text not null check(status in ('present','absent','excused')), entered_by uuid not null references public.person(id), device_id uuid not null, recorded_at timestamptz not null default now(),
 foreign key(meeting_id,member_id) references public.meeting_roster(meeting_id,member_id), foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id)
);
create index attendance_latest on public.attendance(meeting_id,member_id,revision desc);
create table public.meeting_closing(
 id uuid primary key default gen_random_uuid(), revision bigint generated always as identity unique, organisation_id uuid not null references public.organisation(id), meeting_id uuid not null,
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'), expected_cash bigint not null check(expected_cash>=0), counted_cash bigint not null check(counted_cash>=0), difference bigint not null,
 explanation text not null check(length(explanation)<=500 and (difference=0 or explanation ~ '[^[:space:]]')), calc_version text not null check(calc_version='groups-meetings-v1'),
 entered_by uuid not null references public.person(id), device_id uuid not null, recorded_at timestamptz not null default now(),
 unique(id,meeting_id,organisation_id), foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id), check(difference=counted_cash-expected_cash)
);
create index meeting_closing_latest on public.meeting_closing(meeting_id,revision desc);
create table public.meeting_approval(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), meeting_id uuid not null, closing_id uuid not null,
 officer_id uuid not null references public.person(id), device_id uuid not null, recorded_at timestamptz not null default now(), unique(closing_id,officer_id),
 foreign key(closing_id,meeting_id,organisation_id) references public.meeting_closing(id,meeting_id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id)
);
create index meeting_org_date on public.meeting(organisation_id,meeting_date);
create index group_txn_meeting on public.group_txn(meeting_id,organisation_id);
create index meeting_session_org on public.meeting_session(organisation_id,meeting_id);
create index meeting_roster_org on public.meeting_roster(organisation_id,meeting_id);
create index meeting_roster_member on public.meeting_roster(member_id,organisation_id);
create index attendance_org on public.attendance(organisation_id,meeting_id);
create index meeting_closing_org on public.meeting_closing(organisation_id,meeting_id);
create index meeting_approval_org on public.meeting_approval(organisation_id,closing_id);
create index meeting_approval_officer on public.meeting_approval(officer_id,organisation_id);
alter table public.meeting add column closed_proposal_id uuid;
alter table public.meeting add constraint meeting_closed_proposal foreign key(closed_proposal_id,id,organisation_id) references public.meeting_closing(id,meeting_id,organisation_id);

do $$ declare tbl text; begin
 foreach tbl in array array['meeting_session','meeting_roster','attendance','meeting_closing','meeting_approval'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated',tbl);
  execute format('grant select on public.%I to authenticated,yapesa_meetings',tbl);
  execute format('grant insert on public.%I to yapesa_meetings',tbl);
  execute format('create policy officer_read on public.%I for select to authenticated using(private.is_officer(organisation_id))',tbl);
  execute format('create policy meeting_executor_read on public.%I for select to yapesa_meetings using(private.is_officer(organisation_id))',tbl);
  execute format('create policy meeting_executor_insert on public.%I for insert to yapesa_meetings with check(private.is_officer(organisation_id))',tbl);
  execute format('create trigger immutable_record before update or delete on public.%I for each row execute function private.immutable_record()',tbl);
 end loop;
end $$;
create policy attendance_own_read on public.attendance for select to authenticated using(private.can_read_org(organisation_id) and member_id=private.current_person());
grant usage,select on sequence public.attendance_revision_seq,public.meeting_closing_revision_seq to yapesa_meetings;
grant usage on schema public,private,auth,extensions to yapesa_meetings;
grant execute on function private.is_platform_admin() to yapesa_meetings;
grant execute on function private.session_active(boolean),private.current_person(),private.has_role(uuid,text[]),private.requires_mfa(),private.can_read_org(uuid),private.is_officer(uuid),private.can_record(uuid),private.person_visible(uuid),private.can_read_journal(uuid) to yapesa_meetings;
grant select on public.person,public.membership,public.organisation,public.cycle,public.meeting,public.group_settings,public.device,public.group_txn,public.journal_line,public.ledger_account,public.sync_receipt to yapesa_meetings;
grant insert on public.meeting,public.device,public.sync_receipt,public.audit_log to yapesa_meetings;
grant update(writer_device_id) on public.group_settings to yapesa_meetings;
grant update(status,closed_proposal_id) on public.meeting to yapesa_meetings;
do $$ declare tbl text; begin
 foreach tbl in array array['person','membership'] loop execute format('create policy meeting_executor_lookup on public.%I for select to yapesa_meetings using(private.session_active(true))',tbl); end loop;
 foreach tbl in array array['organisation','cycle','meeting','group_settings','device','group_txn','journal_line','ledger_account','sync_receipt'] loop
  execute format('create policy meeting_executor_read on public.%I for select to yapesa_meetings using(private.is_officer(%I))',tbl,case when tbl='organisation' then 'id' else 'organisation_id' end);
 end loop;
 foreach tbl in array array['meeting','device','sync_receipt','audit_log'] loop execute format('create policy meeting_executor_insert on public.%I for insert to yapesa_meetings with check(private.is_officer(organisation_id))',tbl); end loop;
end $$;
create policy meeting_executor_update on public.meeting for update to yapesa_meetings using(private.is_officer(organisation_id)) with check(private.is_officer(organisation_id));
create policy meeting_executor_settings on public.group_settings for update to yapesa_meetings using(private.can_record(organisation_id)) with check(private.can_record(organisation_id));

-- An opening snapshot is immutable. Later backdated money cannot change it.
-- This trigger also covers older purchase/reversal RPCs, not just the new API.
grant select,insert on public.meeting_roster to yapesa_poster;
grant select on public.meeting_session to yapesa_poster;
create policy poster_session_read on public.meeting_session for select to yapesa_poster using(private.can_record(organisation_id));
create policy poster_roster_read on public.meeting_roster for select to yapesa_poster using(private.can_record(organisation_id));
create policy poster_roster_insert on public.meeting_roster for insert to yapesa_poster with check(private.can_record(organisation_id));
create function private.guard_meeting_post() returns trigger language plpgsql security invoker set search_path='' as $$
declare target public.meeting; boundary date; begin
 perform pg_advisory_xact_lock(hashtextextended(new.organisation_id::text,0));
 select * into strict target from public.meeting where id=new.meeting_id and organisation_id=new.organisation_id;
 select max(m.meeting_date) into boundary from public.meeting m where m.organisation_id=new.organisation_id and (m.status='closed' or exists(select 1 from public.meeting_session s where s.meeting_id=m.id));
 if target.status<>'open' or target.meeting_date<boundary then raise exception 'Meeting history is locked' using errcode='22023'; end if;
 if exists(select 1 from public.meeting_session where meeting_id=target.id) then
  insert into public.meeting_roster(organisation_id,meeting_id,member_id) values(new.organisation_id,new.meeting_id,new.member_id) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function private.guard_meeting_post() from public,anon,authenticated;
create trigger guard_meeting_post before insert on public.group_txn for each row execute function private.guard_meeting_post();

create function private.cash_reconciliation(p_open text,p_in text,p_out text,p_counted text) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare value text; expected numeric; begin
 foreach value in array array[p_open,p_in,p_out,p_counted] loop
  if value is null or value !~ '^(0|[1-9][0-9]{0,18})$' or value::numeric>9223372036854775807 then raise exception 'Invalid cash amount' using errcode='22023'; end if;
 end loop;
 expected:=p_open::numeric+p_in::numeric-p_out::numeric;
 if expected<0 or expected>9223372036854775807 then raise exception 'Invalid cash balance' using errcode='22023'; end if;
 return jsonb_build_object('expected_cash',expected::text,'difference',(p_counted::numeric-expected)::text,'calc_version','groups-meetings-v1');
end $$;
revoke all on function private.cash_reconciliation(text,text,text,text) from public,anon,authenticated;
grant execute on function private.cash_reconciliation(text,text,text,text) to authenticated,yapesa_meetings;

create function private.meeting_snapshot(p_org uuid,p_meeting uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare opening numeric; cash_in numeric; cash_out numeric; expected numeric; roster jsonb; transactions jsonb; begin
 select opening_cash into strict opening from public.meeting_session where organisation_id=p_org and meeting_id=p_meeting;
 select coalesce(sum(l.amount) filter(where l.side='debit'),0),coalesce(sum(l.amount) filter(where l.side='credit'),0) into cash_in,cash_out
 from public.journal_line l join public.ledger_account a on a.id=l.account_id join public.group_txn t on t.journal_id=l.journal_id where t.meeting_id=p_meeting and t.organisation_id=p_org and a.code='cash';
 expected:=(private.cash_reconciliation(opening::text,cash_in::text,cash_out::text,'0')->>'expected_cash')::numeric;
 if expected<0 or expected>9223372036854775807 or cash_in>9223372036854775807 or cash_out>9223372036854775807 then raise exception 'Invalid cash balance' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('member_id',r.member_id,'attendance_id',a.id,'status',a.status) order by r.member_id),'[]'::jsonb) into roster from public.meeting_roster r left join lateral(select id,status from public.attendance where meeting_id=r.meeting_id and member_id=r.member_id order by revision desc limit 1) a on true where r.meeting_id=p_meeting and r.organisation_id=p_org;
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into transactions from public.group_txn where meeting_id=p_meeting and organisation_id=p_org;
 return jsonb_build_object('opening_cash',opening::text,'cash_in',cash_in::text,'cash_out',cash_out::text,'expected_cash',expected::text,'roster',roster,'transactions',transactions);
end $$;
revoke all on function private.meeting_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function private.meeting_snapshot(uuid,uuid) to authenticated,yapesa_meetings;
create function private.meeting_hash(p_snapshot jsonb) returns text language sql immutable security invoker set search_path='' as $$ select encode(extensions.digest(p_snapshot::text,'sha256'),'hex'); $$;
revoke all on function private.meeting_hash(jsonb) from public,anon,authenticated;
grant execute on function private.meeting_hash(jsonb) to authenticated,yapesa_meetings;
create function private.officer_eligible(p_org uuid,p_person uuid) returns boolean language sql stable security invoker set search_path='' as $$ select exists(select 1 from public.membership where organisation_id=p_org and person_id=p_person and role in ('secretary','treasurer','chair') and starts_at<=now() and (ends_at is null or ends_at>now())); $$;
revoke all on function private.officer_eligible(uuid,uuid) from public,anon,authenticated;
grant execute on function private.officer_eligible(uuid,uuid) to authenticated,yapesa_meetings;

-- One bounded command entry point, with action-specific permissions. The caller
-- cannot provide an actor, expected cash, opening balance or approval count.
create function private.meeting_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_date date,p_meeting uuid,p_member uuid,p_status text,p_counted text,p_explanation text,p_proposal uuid)
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
   select * into previous from public.meeting where organisation_id=p_org and meeting_date<target.meeting_date and status='closed' order by meeting_date desc,id desc limit 1;
   if found then
    select counted_cash into opening from public.meeting_closing where id=previous.closed_proposal_id;
    if opening is null then raise exception 'Previous closing needs reconciliation' using errcode='22023'; end if;
   else
    select coalesce(sum(case when l.side='debit' then l.amount else -l.amount end),0) into opening from public.journal_line l join public.ledger_account a on a.id=l.account_id join public.group_txn t on t.journal_id=l.journal_id join public.meeting m on m.id=t.meeting_id where l.organisation_id=p_org and a.code='cash' and m.meeting_date<target.meeting_date;
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
grant create on schema private to yapesa_meetings;
alter function private.meeting_command(uuid,text,uuid,uuid,date,uuid,uuid,text,text,text,uuid) owner to yapesa_meetings;
revoke create on schema private from yapesa_meetings;
revoke all on function private.meeting_command(uuid,text,uuid,uuid,date,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function private.meeting_command(uuid,text,uuid,uuid,date,uuid,uuid,text,text,text,uuid) to authenticated;
create function public.meeting_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_date date default null,p_meeting uuid default null,p_member uuid default null,p_status text default null,p_counted text default null,p_explanation text default null,p_proposal uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.meeting_command(p_org,p_action,p_request,p_device,p_date,p_meeting,p_member,p_status,p_counted,p_explanation,p_proposal); $$;
revoke all on function public.meeting_command(uuid,text,uuid,uuid,date,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.meeting_command(uuid,text,uuid,uuid,date,uuid,uuid,text,text,text,uuid) to authenticated;

create function public.meeting_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare meetings jsonb:='[]'::jsonb; target public.meeting; snapshot jsonb; proposal public.meeting_closing; info jsonb; begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Inactive group' using errcode='22023'; end if;
 for target in select * from public.meeting where organisation_id=p_org order by meeting_date desc,id loop
  snapshot:=null; info:=null;
  if exists(select 1 from public.meeting_session where meeting_id=target.id) then snapshot:=private.meeting_snapshot(p_org,target.id); end if;
  if target.status='closed' then select * into proposal from public.meeting_closing where id=target.closed_proposal_id;
  else select * into proposal from public.meeting_closing where meeting_id=target.id order by revision desc limit 1; end if;
  if found then info:=jsonb_build_object('id',proposal.id,'expected_cash',proposal.expected_cash::text,'counted_cash',proposal.counted_cash::text,'difference',proposal.difference::text,'explanation',proposal.explanation,'stale',snapshot is null or proposal.snapshot_hash<>private.meeting_hash(snapshot),
   'approvals',coalesce((select jsonb_agg(jsonb_build_object('person_id',a.officer_id,'name',p.display_name,'eligible',private.officer_eligible(p_org,a.officer_id)) order by a.recorded_at,a.id) from public.meeting_approval a join public.person p on p.id=a.officer_id where a.closing_id=proposal.id),'[]'::jsonb)); end if;
  meetings:=meetings||jsonb_build_array(jsonb_build_object('id',target.id,'date',target.meeting_date,'status',target.status,'opening_cash',snapshot->>'opening_cash','cash_in',snapshot->>'cash_in','cash_out',snapshot->>'cash_out','expected_cash',snapshot->>'expected_cash','proposal',info,
   'roster',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'status',a.status) order by p.display_name,p.id) from public.meeting_roster r join public.person p on p.id=r.member_id left join lateral(select status from public.attendance where meeting_id=r.meeting_id and member_id=r.member_id order by revision desc limit 1) a on true where r.meeting_id=target.id),'[]'::jsonb)));
 end loop;
 return jsonb_build_object('currency',(select currency from public.organisation where id=p_org),'can_record',private.can_record(p_org),'can_approve',private.session_active(true) and private.has_role(p_org,array['secretary','treasurer','chair']),'meetings',meetings);
end $$;
revoke all on function public.meeting_workspace(uuid) from public,anon,authenticated;
grant execute on function public.meeting_workspace(uuid) to authenticated;

-- Preserve names needed to review attendance and officer signatures after roles end.
create or replace function private.person_visible(p_person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.session_active(private.requires_mfa()) and
 (p_person=private.current_person()
 or exists(select 1 from public.membership m where m.person_id=p_person and private.is_officer(m.organisation_id) and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))
 or exists(select 1 from public.group_txn t where t.member_id=p_person and private.is_officer(t.organisation_id))
 or exists(select 1 from public.meeting_roster r where r.member_id=p_person and private.is_officer(r.organisation_id))
 or exists(select 1 from public.meeting_approval a where a.officer_id=p_person and private.is_officer(a.organisation_id)));
$$;

create or replace function public.group_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb; begin
 if not private.can_read_org(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select jsonb_build_object(
 'group',jsonb_build_object('id',o.id,'name',o.name,'currency',o.currency,'time_zone',o.time_zone,'country_code',o.country_code,'minor_digits',cr.minor_digits,'max_shares',gs.max_shares_per_meeting::text,'can_record',private.can_record(o.id),'can_preview_shareout',private.is_officer(o.id)),
 'cycle',(select jsonb_build_object('id',c.id,'starts_on',c.starts_on,'ends_on',c.ends_on,'share_price',c.share_price::text) from public.cycle c where c.organisation_id=o.id and c.status='active'),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'active',exists(select 1 from public.membership m where m.person_id=p.id and m.organisation_id=o.id and m.role='member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))) order by p.display_name) from public.person p where exists(select 1 from public.membership m where m.person_id=p.id and m.organisation_id=o.id and m.role='member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())) or exists(select 1 from public.group_txn t where t.member_id=p.id and t.organisation_id=o.id)),'[]'::jsonb),
 'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'member_id',t.member_id,'meeting_date',m.meeting_date,'recorded_at',t.recorded_at,'shares',t.shares::text,'amount',t.amount::text,'currency',t.currency,'journal_id',t.journal_id,'calculation_mismatch',t.calculation_mismatch,'note',t.note,'reverses',t.reverses) order by t.recorded_at desc) from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.organisation_id=o.id),'[]'::jsonb),
 'meeting_count',(select count(*)::text from public.meeting where organisation_id=o.id),
 'journal_lines',coalesce((select jsonb_agg(jsonb_build_object('journal_id',l.journal_id,'account',a.code,'side',l.side,'amount',l.amount::text)) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=o.id),'[]'::jsonb)) into data
 from public.organisation o join public.currency_reference cr on cr.code=o.currency join public.group_settings gs on gs.organisation_id=o.id where o.id=p_org and o.type='group' and o.status='active';
 return data;
end $$;
