-- Fines are obligations until paid. Only receipts/reversals affect cash/income.
do $$ begin if not exists(select 1 from pg_roles where rolname='yapesa_fines') then create role yapesa_fines nologin noinherit nobypassrls; end if; end $$;
grant yapesa_fines to postgres;
alter table public.ledger_account drop constraint ledger_account_code_check;
alter table public.ledger_account add constraint ledger_account_code_check check(code in ('cash','share_capital','social_fund','fines_income'));
create table public.fine_policy(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), rules jsonb not null check(jsonb_typeof(rules)='array'), entered_by uuid not null references public.person(id), recorded_at timestamptz not null default now(), unique(id,organisation_id)
);
alter table public.group_settings add column fine_policy_id uuid;
alter table public.group_settings add constraint settings_fine_policy foreign key(fine_policy_id,organisation_id) references public.fine_policy(id,organisation_id);
create table public.fine_meeting_policy(
 meeting_id uuid primary key, organisation_id uuid not null references public.organisation(id), policy_id uuid not null,
 foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id), foreign key(policy_id,organisation_id) references public.fine_policy(id,organisation_id), unique(meeting_id,policy_id,organisation_id)
);
create table public.fine_charge(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), meeting_id uuid not null, policy_id uuid not null, code text not null,
 member_id uuid not null references public.person(id), amount bigint not null check(amount>0), attendance_id uuid unique references public.attendance(id), reason text not null check(length(reason) between 1 and 240 and reason ~ '[^[:space:]]'), entered_by uuid not null references public.person(id), device_id uuid not null, recorded_at timestamptz not null default now(),
 unique(id,organisation_id), foreign key(meeting_id,policy_id,organisation_id) references public.fine_meeting_policy(meeting_id,policy_id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id)
);
create table public.fine_event(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), meeting_id uuid not null, member_id uuid not null references public.person(id), charge_id uuid not null,
 kind text not null check(kind in ('payment','reversal','waiver')), cash bigint not null, waived bigint not null check(waived>=0), reverses uuid, journal_id uuid unique,
 reason text not null check(length(reason) between 1 and 240 and reason ~ '[^[:space:]]'), entered_by uuid not null references public.person(id), device_id uuid not null, recorded_at timestamptz not null default now(), calc_version text not null check(calc_version='groups-fines-v1'),
 unique(id,organisation_id), foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id), foreign key(charge_id,organisation_id) references public.fine_charge(id,organisation_id), foreign key(journal_id,organisation_id) references public.journal(id,organisation_id), foreign key(reverses,organisation_id) references public.fine_event(id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id),
 check((kind='payment' and cash>0 and waived=0 and reverses is null and journal_id is not null) or (kind='reversal' and cash<0 and waived=0 and reverses is not null and reverses<>id and journal_id is not null) or (kind='waiver' and cash=0 and waived>0 and reverses is null and journal_id is null))
);
create unique index fine_one_reversal on public.fine_event(reverses) where reverses is not null;
create index fine_policy_org on public.fine_policy(organisation_id);
create index fine_meeting_org on public.fine_meeting_policy(organisation_id,meeting_id);
create index fine_charge_meeting on public.fine_charge(organisation_id,meeting_id,member_id);
create index fine_charge_member on public.fine_charge(member_id,organisation_id);
create index fine_event_meeting on public.fine_event(organisation_id,meeting_id);
create index fine_event_charge on public.fine_event(charge_id);
create index fine_event_member on public.fine_event(member_id,organisation_id);
grant usage on schema public,private,auth to yapesa_fines;
grant execute on function private.is_platform_admin(),private.session_active(boolean),private.current_person(),private.has_role(uuid,text[]),private.requires_mfa(),private.can_read_org(uuid),private.is_officer(uuid),private.can_record(uuid),private.person_visible(uuid),private.can_read_journal(uuid),private.meeting_snapshot(uuid,uuid),private.cash_reconciliation(text,text,text,text) to yapesa_fines;
grant select on public.person,public.membership,public.organisation,public.group_settings,public.cycle,public.meeting,public.meeting_session,public.device,public.ledger_account,public.journal,public.journal_line,public.group_txn,public.social_txn,public.social_rule,public.social_meeting_policy,public.social_request,public.social_resolution,public.meeting_roster,public.attendance,public.sync_receipt to yapesa_fines;
grant insert on public.device,public.journal,public.journal_line,public.meeting_roster,public.sync_receipt,public.audit_log to yapesa_fines;
do $$ declare tbl text; begin
 foreach tbl in array array['fine_policy','fine_meeting_policy','fine_charge','fine_event'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated',tbl);
  execute format('grant select on public.%I to authenticated,yapesa_fines,yapesa_meetings,yapesa_social',tbl);
  execute format('create policy fine_executor_read on public.%I for select to yapesa_fines,yapesa_meetings,yapesa_social using(private.is_officer(organisation_id))',tbl);
  execute format('create trigger immutable_record before update or delete on public.%I for each row execute function private.immutable_record()',tbl);
 end loop;
 foreach tbl in array array['fine_policy','fine_meeting_policy'] loop execute format('create policy fine_policy_read on public.%I for select to authenticated using(private.can_read_org(organisation_id))',tbl); end loop;
 foreach tbl in array array['fine_charge','fine_event'] loop
  execute format('create policy fine_member_read on public.%I for select to authenticated using(private.can_read_org(organisation_id) and (member_id=private.current_person() or private.is_officer(organisation_id)))',tbl);
  execute format('grant insert on public.%I to yapesa_fines,yapesa_meetings',tbl);
  execute format('create policy fine_executor_insert on public.%I for insert to yapesa_fines,yapesa_meetings with check(private.can_record(organisation_id))',tbl);
 end loop;
 foreach tbl in array array['person','membership'] loop execute format('create policy fines_lookup on public.%I for select to yapesa_fines using(private.session_active(true))',tbl); end loop;
 foreach tbl in array array['organisation','group_settings','cycle','meeting','meeting_session','device','ledger_account','journal','journal_line','group_txn','social_txn','social_rule','social_meeting_policy','social_request','social_resolution','meeting_roster','attendance','sync_receipt'] loop
  execute format('create policy fines_read on public.%I for select to yapesa_fines using(private.is_officer(%I))',tbl,case when tbl='organisation' then 'id' else 'organisation_id' end);
 end loop;
 foreach tbl in array array['device','journal','journal_line','meeting_roster','sync_receipt','audit_log'] loop execute format('create policy fines_insert on public.%I for insert to yapesa_fines with check(private.can_record(organisation_id))',tbl); end loop;
end $$;
grant select,insert on public.fine_policy to yapesa_administrator;
grant update(fine_policy_id) on public.group_settings to yapesa_administrator;
create policy admin_fine_policy on public.fine_policy for all to yapesa_administrator using(private.is_platform_admin()) with check(private.is_platform_admin());
grant insert on public.fine_meeting_policy to yapesa_meetings;
create policy meeting_fine_insert on public.fine_meeting_policy for insert to yapesa_meetings with check(private.can_record(organisation_id));
create function private.capture_fine_policy() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 insert into public.fine_meeting_policy(meeting_id,organisation_id,policy_id) select new.meeting_id,new.organisation_id,fine_policy_id from public.group_settings where organisation_id=new.organisation_id and fine_policy_id is not null;
 return new;
end $$;
revoke all on function private.capture_fine_policy() from public,anon,authenticated;
create trigger capture_fine_policy after insert on public.meeting_session for each row execute function private.capture_fine_policy();
create trigger guard_fine_charge before insert on public.fine_charge for each row execute function private.guard_meeting_post();
-- Collecting an existing obligation from a former member must not enrol them
-- into this meeting's new social contribution requirement.
create function private.guard_fine_event() returns trigger language plpgsql security invoker set search_path='' as $$
declare target public.meeting; boundary date; begin
 perform pg_advisory_xact_lock(hashtextextended(new.organisation_id::text,0));
 select * into strict target from public.meeting where id=new.meeting_id and organisation_id=new.organisation_id;
 select max(m.meeting_date) into boundary from public.meeting m where m.organisation_id=new.organisation_id and (m.status='closed' or exists(select 1 from public.meeting_session s where s.meeting_id=m.id));
 if target.status<>'open' or target.meeting_date<boundary then raise exception 'Meeting history is locked' using errcode='22023'; end if;
 if exists(select 1 from public.membership where organisation_id=new.organisation_id and person_id=new.member_id and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) then
  insert into public.meeting_roster(organisation_id,meeting_id,member_id) values(new.organisation_id,new.meeting_id,new.member_id) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function private.guard_fine_event() from public,anon,authenticated;
create trigger guard_fine_event before insert on public.fine_event for each row execute function private.guard_fine_event();

create function private.admin_fine_policy(p_request uuid,p_device uuid,p_org uuid,p_rules jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb; payload jsonb; rule jsonb; policy_uuid uuid; begin
 payload:=jsonb_build_object('organisation',p_org,'device',p_device,'rules',p_rules);
 prior:=private.admin_begin(p_request,'configure_fines',payload); if prior is not null then return prior; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not private.is_platform_admin() then raise exception 'Not permitted' using errcode='42501'; end if;
 if p_device is null or p_rules is null or jsonb_typeof(p_rules)<>'array' or jsonb_array_length(p_rules)>20 then raise exception 'Invalid fine settings' using errcode='22023'; end if;
 for rule in select value from jsonb_array_elements(p_rules) loop
  if jsonb_typeof(rule)<>'object' or (select count(*) from jsonb_object_keys(rule))<>5 or not (rule ?& array['code','name','amount','trigger','partial']) or rule->'code'='null'::jsonb or rule->'name'='null'::jsonb or rule->'amount'='null'::jsonb or rule->'trigger'='null'::jsonb or rule->'partial'='null'::jsonb or jsonb_typeof(rule->'code')<>'string' or rule->>'code' !~ '^[a-z][a-z0-9_-]{0,39}$' or jsonb_typeof(rule->'name')<>'string' or length(btrim(rule->>'name')) not between 1 and 80 or rule->>'name' !~ '[^[:space:]]' or jsonb_typeof(rule->'amount')<>'string' or rule->>'amount' !~ '^[1-9][0-9]{0,18}$' or (rule->>'amount')::numeric>9223372036854775807 or rule->>'trigger' not in ('manual','absence') or jsonb_typeof(rule->'partial')<>'boolean' then raise exception 'Invalid fine rule' using errcode='22023'; end if;
 end loop;
 if (select count(distinct value->>'code') from jsonb_array_elements(p_rules))<>jsonb_array_length(p_rules) or (select count(*) from jsonb_array_elements(p_rules) where value->>'trigger'='absence')>1 then raise exception 'Duplicate fine rule' using errcode='22023'; end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Invalid group' using errcode='22023'; end if;
 insert into public.fine_policy(organisation_id,rules,entered_by) values(p_org,p_rules,private.current_person()) returning id into policy_uuid;
 insert into public.ledger_account(organisation_id,code) values(p_org,'fines_income') on conflict do nothing;
 update public.group_settings set fine_policy_id=policy_uuid where organisation_id=p_org;
 return private.admin_finish(p_request,'configure_fines',payload,jsonb_build_object('id',p_org),p_org,p_device,policy_uuid);
end $$;
grant create on schema private to yapesa_administrator;
alter function private.admin_fine_policy(uuid,uuid,uuid,jsonb) owner to yapesa_administrator;
revoke create on schema private from yapesa_administrator;
revoke all on function private.admin_fine_policy(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_fine_policy(uuid,uuid,uuid,jsonb) to authenticated;
create function public.admin_fine_policy(p_request uuid,p_device uuid,p_org uuid,p_rules jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_fine_policy(p_request,p_device,p_org,p_rules); $$;
revoke all on function public.admin_fine_policy(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_fine_policy(uuid,uuid,uuid,jsonb) to authenticated;

create function private.fine_due(p_charge uuid) returns numeric language sql stable security invoker set search_path='' as $$ select c.amount-coalesce((select sum(e.cash::numeric+e.waived) from public.fine_event e where e.charge_id=c.id),0) from public.fine_charge c where c.id=p_charge; $$;
revoke all on function private.fine_due(uuid) from public,anon,authenticated;
grant execute on function private.fine_due(uuid) to authenticated,yapesa_fines,yapesa_meetings;
-- Absence is assessed only under the meeting's saved rule. Correcting attendance
-- cancels the unpaid obligation, but cannot silently refund cash already collected.
create function private.attendance_fine() returns trigger language plpgsql security invoker set search_path='' as $$
declare old_status text; policy public.fine_meeting_policy; rule jsonb; charge public.fine_charge; due numeric; begin
 select status into old_status from public.attendance where meeting_id=new.meeting_id and member_id=new.member_id and id<>new.id order by revision desc limit 1;
 if old_status is not distinct from new.status then return new; end if;
 select * into policy from public.fine_meeting_policy where meeting_id=new.meeting_id;
 if not found then return new; end if;
 select value into rule from public.fine_policy p cross join lateral jsonb_array_elements(p.rules) where p.id=policy.policy_id and value->>'trigger'='absence';
 if rule is null then return new; end if;
 if new.status='absent' then
  insert into public.fine_charge(organisation_id,meeting_id,policy_id,code,member_id,amount,attendance_id,reason,entered_by,device_id) values(new.organisation_id,new.meeting_id,policy.policy_id,rule->>'code',new.member_id,(rule->>'amount')::bigint,new.id,'Absence recorded',new.entered_by,new.device_id);
 elsif old_status='absent' then
  for charge in select * from public.fine_charge where meeting_id=new.meeting_id and member_id=new.member_id and attendance_id is not null loop
   if coalesce((select sum(cash) from public.fine_event where charge_id=charge.id),0)>0 then raise exception 'Reverse absence payments before correcting attendance' using errcode='22023'; end if;
   due:=private.fine_due(charge.id);
   if due>0 then insert into public.fine_event(organisation_id,meeting_id,member_id,charge_id,kind,cash,waived,reason,entered_by,device_id,calc_version) values(new.organisation_id,new.meeting_id,new.member_id,charge.id,'waiver',0,due::bigint,'Attendance corrected',new.entered_by,new.device_id,'groups-fines-v1'); end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.attendance_fine() from public,anon,authenticated;
create trigger attendance_fine after insert on public.attendance for each row execute function private.attendance_fine();

create function private.fine_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_meeting uuid,p_member uuid,p_code text,p_amount text,p_reason text,p_target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; prior public.sync_receipt; payload jsonb; result_data jsonb; meet public.meeting; charge public.fine_charge; original public.fine_event; policy_uuid uuid; rule jsonb; due numeric; cash bigint:=0; waived bigint:=0; record_uuid uuid:=gen_random_uuid(); journal_uuid uuid; expected numeric; begin
 if p_action is null or p_action not in ('assess','pay','waive','reverse') or not private.can_record(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not private.can_record(p_org) then raise exception 'Authority changed' using errcode='42501'; end if;
 actor:=private.current_person();
 if p_request is null or p_request::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or p_device is null or p_reason is null or length(p_reason) not between 1 and 240 or p_reason !~ '[^[:space:]]' then raise exception 'Fine reason required' using errcode='22023'; end if;
 payload:=jsonb_build_object('actor',actor,'action',p_action,'device',p_device,'meeting',p_meeting,'member',p_member,'code',p_code,'amount',p_amount,'reason',p_reason,'target',p_target);
 select * into prior from public.sync_receipt where client_id=p_request;
 if found then if prior.organisation_id<>p_org or prior.request<>payload then raise exception 'Idempotency conflict' using errcode='23505'; end if; return prior.result; end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Inactive group' using errcode='22023'; end if;
 if (select writer_device_id from public.group_settings where organisation_id=p_org) is distinct from p_device then raise exception 'Writer device required' using errcode='42501'; end if;
 if not exists(select 1 from public.device where id=p_device and organisation_id=p_org) then raise exception 'Registered device required' using errcode='22023'; end if;
 select * into strict meet from public.meeting where id=p_meeting and organisation_id=p_org;
 if meet.status<>'open' or not exists(select 1 from public.meeting_session where meeting_id=meet.id) or not exists(select 1 from public.cycle where id=meet.cycle_id and status='active') then raise exception 'Open meeting required' using errcode='22023'; end if;
 if p_action='assess' then
  if p_member is null or p_code is null or p_amount is not null or p_target is not null then raise exception 'Invalid fine assessment' using errcode='22023'; end if;
  select policy_id into strict policy_uuid from public.fine_meeting_policy where meeting_id=meet.id;
  select value into rule from public.fine_policy p cross join lateral jsonb_array_elements(p.rules) where p.id=policy_uuid and value->>'code'=p_code and value->>'trigger'='manual';
  if rule is null or not exists(select 1 from public.membership where organisation_id=p_org and person_id=p_member and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'Configured fine and active member required' using errcode='22023'; end if;
  insert into public.fine_charge(id,organisation_id,meeting_id,policy_id,code,member_id,amount,reason,entered_by,device_id) values(record_uuid,p_org,meet.id,policy_uuid,p_code,p_member,(rule->>'amount')::bigint,p_reason,actor,p_device);
 else
  if p_target is null or p_member is not null or p_code is not null then raise exception 'Fine target required' using errcode='22023'; end if;
  if p_action='reverse' then
   if p_amount is not null then raise exception 'Reversal amount is fixed' using errcode='22023'; end if;
   select * into strict original from public.fine_event where id=p_target and organisation_id=p_org and kind='payment' and meeting_id=meet.id;
   if exists(select 1 from public.fine_event where reverses=original.id) then raise exception 'Already reversed' using errcode='23505'; end if;
   select * into strict charge from public.fine_charge where id=original.charge_id and organisation_id=p_org;
   cash:=-original.cash;
  else
   select * into strict charge from public.fine_charge where id=p_target and organisation_id=p_org;
   if (select meeting_date from public.meeting where id=charge.meeting_id)>meet.meeting_date then raise exception 'Cannot collect future fine' using errcode='22023'; end if;
   due:=private.fine_due(charge.id);
   if due<=0 then raise exception 'Fine already resolved' using errcode='23505'; end if;
   if p_action='waive' then
    if p_amount is not null then raise exception 'Waiver is the unpaid remainder' using errcode='22023'; end if;
    waived:=due::bigint;
   else
    if p_amount is null or p_amount !~ '^[1-9][0-9]{0,18}$' or p_amount::numeric>due then raise exception 'Invalid fine payment' using errcode='22023'; end if;
    select value into strict rule from public.fine_policy p cross join lateral jsonb_array_elements(p.rules) where p.id=charge.policy_id and value->>'code'=charge.code;
    if not (rule->>'partial')::boolean and p_amount::numeric<>due then raise exception 'Full fine payment required by saved rule' using errcode='22023'; end if;
    cash:=p_amount::bigint;
   end if;
  end if;
  if cash<>0 then
   expected:=(private.meeting_snapshot(p_org,meet.id)->>'expected_cash')::numeric+cash;
   if expected<0 or expected>9223372036854775807 then raise exception 'Invalid cash balance' using errcode='22023'; end if;
   journal_uuid:=gen_random_uuid();
   insert into public.journal(id,organisation_id,currency,calc_version) select journal_uuid,p_org,currency,'groups-fines-v1' from public.organisation where id=p_org;
   if p_action='reverse' then
    insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select p_org,journal_uuid,account_id,case when side='debit' then 'credit' else 'debit' end,amount from public.journal_line where journal_id=original.journal_id;
   else
    insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select p_org,journal_uuid,id,case when code='cash' then 'debit' else 'credit' end,cash from public.ledger_account where organisation_id=p_org and code in ('cash','fines_income');
   end if;
   if (select count(*) from public.journal_line where journal_id=journal_uuid)<>2 then raise exception 'Fine accounts incomplete' using errcode='23514'; end if;
  end if;
  insert into public.fine_event(id,organisation_id,meeting_id,member_id,charge_id,kind,cash,waived,reverses,journal_id,reason,entered_by,device_id,calc_version) values(record_uuid,p_org,meet.id,charge.member_id,charge.id,case p_action when 'pay' then 'payment' when 'waive' then 'waiver' else 'reversal' end,cash,waived,case when p_action='reverse' then original.id else null end,journal_uuid,p_reason,actor,p_device,'groups-fines-v1');
 end if;
 result_data:=jsonb_build_object('id',record_uuid);
 insert into public.sync_receipt(client_id,organisation_id,request,result) values(p_request,p_org,payload,result_data);
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(p_org,actor,p_device,'fine_'||p_action,record_uuid,payload||result_data);
 return result_data;
end $$;
grant create on schema private to yapesa_fines;
alter function private.fine_command(uuid,text,uuid,uuid,uuid,uuid,text,text,text,uuid) owner to yapesa_fines;
revoke create on schema private from yapesa_fines;
revoke all on function private.fine_command(uuid,text,uuid,uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function private.fine_command(uuid,text,uuid,uuid,uuid,uuid,text,text,text,uuid) to authenticated;
create function public.fine_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_meeting uuid,p_member uuid default null,p_code text default null,p_amount text default null,p_reason text default '',p_target uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.fine_command(p_org,p_action,p_request,p_device,p_meeting,p_member,p_code,p_amount,p_reason,p_target); $$;
revoke all on function public.fine_command(uuid,text,uuid,uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.fine_command(uuid,text,uuid,uuid,uuid,uuid,text,text,text,uuid) to authenticated;

create or replace function private.meeting_snapshot(p_org uuid,p_meeting uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare opening numeric; cash_in numeric; cash_out numeric; expected numeric; roster jsonb; transactions jsonb; snapshot jsonb; begin
 select opening_cash into strict opening from public.meeting_session where organisation_id=p_org and meeting_id=p_meeting;
 select coalesce(sum(l.amount) filter(where l.side='debit'),0),coalesce(sum(l.amount) filter(where l.side='credit'),0) into cash_in,cash_out
 from public.journal_line l join public.ledger_account a on a.id=l.account_id join (select journal_id,meeting_id,organisation_id from public.group_txn union all select journal_id,meeting_id,organisation_id from public.social_txn union all select journal_id,meeting_id,organisation_id from public.fine_event where journal_id is not null) t on t.journal_id=l.journal_id where t.meeting_id=p_meeting and t.organisation_id=p_org and a.code='cash';
 expected:=(private.cash_reconciliation(opening::text,cash_in::text,cash_out::text,'0')->>'expected_cash')::numeric;
 if expected<0 or expected>9223372036854775807 or cash_in>9223372036854775807 or cash_out>9223372036854775807 then raise exception 'Invalid cash balance' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('member_id',r.member_id,'attendance_id',a.id,'status',a.status) order by r.member_id),'[]'::jsonb) into roster from public.meeting_roster r left join lateral(select id,status from public.attendance where meeting_id=r.meeting_id and member_id=r.member_id order by revision desc limit 1) a on true where r.meeting_id=p_meeting and r.organisation_id=p_org;
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into transactions from public.group_txn where meeting_id=p_meeting and organisation_id=p_org;
 snapshot:=jsonb_build_object('opening_cash',opening::text,'cash_in',cash_in::text,'cash_out',cash_out::text,'expected_cash',expected::text,'roster',roster,'transactions',transactions);
 if exists(select 1 from public.social_meeting_policy where meeting_id=p_meeting) then
  snapshot:=snapshot||jsonb_build_object('social_rule',(select rule_id from public.social_meeting_policy where meeting_id=p_meeting),
   'social_transactions',coalesce((select jsonb_agg(id order by id) from public.social_txn where meeting_id=p_meeting),'[]'::jsonb),
   'social_requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'resolution',s.id) order by r.id) from public.social_request r left join public.social_resolution s on s.request_id=r.id where r.meeting_id=p_meeting),'[]'::jsonb));
 end if;
 if exists(select 1 from public.fine_meeting_policy where meeting_id=p_meeting) or exists(select 1 from public.fine_event where meeting_id=p_meeting) then
  snapshot:=snapshot||jsonb_build_object('fine_policy',(select policy_id from public.fine_meeting_policy where meeting_id=p_meeting),
   'fine_charges',coalesce((select jsonb_agg(id order by id) from public.fine_charge where meeting_id=p_meeting),'[]'::jsonb),
   'fine_events',coalesce((select jsonb_agg(id order by id) from public.fine_event where meeting_id=p_meeting),'[]'::jsonb));
 end if;
 return snapshot;
end $$;

create or replace function private.person_visible(p_person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.session_active(private.requires_mfa()) and
 (p_person=private.current_person()
 or exists(select 1 from public.membership m where m.person_id=p_person and private.is_officer(m.organisation_id) and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))
 or exists(select 1 from public.group_txn t where t.member_id=p_person and private.is_officer(t.organisation_id))
 or exists(select 1 from public.meeting_roster r where r.member_id=p_person and private.is_officer(r.organisation_id))
 or exists(select 1 from public.meeting_approval a where a.officer_id=p_person and private.is_officer(a.organisation_id))
 or exists(select 1 from public.social_request s where s.member_id=p_person and private.is_officer(s.organisation_id))
 or exists(select 1 from public.social_txn s where s.member_id=p_person and private.is_officer(s.organisation_id))
 or exists(select 1 from public.fine_charge s where s.member_id=p_person and private.is_officer(s.organisation_id)));
$$;


create or replace function private.can_read_journal(p_journal uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
 exists(select 1 from public.group_txn t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id)))
 or exists(select 1 from public.social_txn t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id)))
 or exists(select 1 from public.fine_event t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id))));
$$;

grant select on public.fine_charge,public.fine_event to yapesa_administrator;
create policy fine_admin_charge_read on public.fine_charge for select to yapesa_administrator using(private.is_platform_admin());
create or replace function private.admin_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_platform_admin() then raise exception 'Verified platform administrator required' using errcode='42501'; end if;
 return jsonb_build_object(
 'currencies',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'minor_digits',minor_digits) order by code),'[]') from public.currency_reference),
 'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name,'phone',phone,'has_login',auth_user_id is not null,'staff_ready',private.staff_ready(id)) order by display_name),'[]') from public.person),
 'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'country_code',o.country_code,'currency',o.currency,'time_zone',o.time_zone,'max_shares',gs.max_shares_per_meeting::text,
 'configuration_locked',exists(select 1 from public.group_txn t where t.organisation_id=o.id) or exists(select 1 from public.social_txn t where t.organisation_id=o.id) or exists(select 1 from public.fine_charge t where t.organisation_id=o.id),
 'cycle',(select jsonb_build_object('starts_on',c.starts_on,'ends_on',c.ends_on,'share_price',c.share_price::text) from public.cycle c where c.organisation_id=o.id and c.status='active'),
 'memberships',(select coalesce(jsonb_agg(jsonb_build_object('person_id',m.person_id,'role',m.role) order by m.person_id,m.role),'[]') from public.membership m where m.organisation_id=o.id and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))) order by o.name),'[]')
 from public.organisation o join public.group_settings gs on gs.organisation_id=o.id where o.type='group' and o.status='active'));
end $$;

create or replace function private.admin_configure_group(p_request uuid,p_device uuid,p_org uuid,p_name text,p_max text,p_starts date,p_ends date,p_price text) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; prior jsonb; begin
 payload:=jsonb_build_object('device_id',p_device,'organisation_id',p_org,'name',p_name,'max_shares',p_max,'starts_on',p_starts,'ends_on',p_ends,'share_price',p_price);
 prior:=private.admin_begin(p_request,'configure_group',payload); if prior is not null then return prior; end if;
 -- Same organisation lock as posting: configuration cannot race the first purchase.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') or p_name is null or length(btrim(p_name)) not between 1 and 200
 or p_max is null or p_max !~ '^[1-9][0-9]{0,18}$' or p_price is null or p_price !~ '^[1-9][0-9]{0,18}$'
 or p_starts is null or p_ends is null or p_ends<p_starts then raise exception 'Invalid group configuration' using errcode='22023'; end if;
 if exists(select 1 from public.group_txn where organisation_id=p_org) or exists(select 1 from public.social_txn where organisation_id=p_org) or exists(select 1 from public.fine_charge where organisation_id=p_org) then raise exception 'Posted configuration is locked' using errcode='22023'; end if;
 update public.organisation set name=btrim(p_name) where id=p_org;
 update public.group_settings set max_shares_per_meeting=p_max::bigint where organisation_id=p_org;
 if exists(select 1 from public.cycle where organisation_id=p_org and status='active' and share_price<>p_price::bigint) then raise exception 'Cycle share price is fixed' using errcode='22023'; end if;
 update public.cycle set starts_on=p_starts,ends_on=p_ends where organisation_id=p_org and status='active';
 if not found then insert into public.cycle(organisation_id,starts_on,ends_on,share_price) values(p_org,p_starts,p_ends,p_price::bigint); end if;
 return private.admin_finish(p_request,'configure_group',payload,jsonb_build_object('id',p_org),p_org,p_device,p_org);
end $$;

create function public.fine_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not private.can_read_org(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Inactive group' using errcode='22023'; end if;
 return jsonb_build_object('can_record',private.can_record(p_org),'can_configure',private.is_platform_admin(),'currency',(select currency from public.organisation where id=p_org),
 'rules',coalesce((select p.rules from public.group_settings s join public.fine_policy p on p.id=s.fine_policy_id where s.organisation_id=p_org),'[]'::jsonb),
 'meetings',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'date',m.meeting_date,'status',m.status,'ready',exists(select 1 from public.meeting_session where meeting_id=m.id),'rules',coalesce(p.rules,'[]'::jsonb)) order by m.meeting_date desc,m.id) from public.meeting m left join public.fine_meeting_policy s on s.meeting_id=m.id left join public.fine_policy p on p.id=s.policy_id where m.organisation_id=p_org),'[]'::jsonb),
 'charges',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'meeting_id',c.meeting_id,'date',m.meeting_date,'member_id',c.member_id,'name',u.display_name,'fine',r.value->>'name','amount',c.amount::text,'partial',(r.value->>'partial')::boolean,'paid',coalesce((select sum(cash)::text from public.fine_event where charge_id=c.id),'0'),'waived',coalesce((select sum(waived)::text from public.fine_event where charge_id=c.id),'0'),'due',private.fine_due(c.id)::text,'reason',c.reason,'automatic',c.attendance_id is not null) order by c.recorded_at desc,c.id) from public.fine_charge c join public.meeting m on m.id=c.meeting_id join public.person u on u.id=c.member_id join public.fine_policy p on p.id=c.policy_id cross join lateral jsonb_array_elements(p.rules) r where c.organisation_id=p_org and r.value->>'code'=c.code),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'meeting_id',e.meeting_id,'date',m.meeting_date,'charge_id',e.charge_id,'name',p.display_name,'kind',e.kind,'cash',e.cash::text,'waived',e.waived::text,'reverses',e.reverses,'reason',e.reason,'journal_id',e.journal_id,'journal',coalesce((select jsonb_agg(jsonb_build_object('account',a.code,'side',l.side,'amount',l.amount::text) order by a.code) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.journal_id=e.journal_id),'[]'::jsonb)) order by e.recorded_at desc,e.id) from public.fine_event e join public.meeting m on m.id=e.meeting_id join public.person p on p.id=e.member_id where e.organisation_id=p_org),'[]'::jsonb));
end $$;
revoke all on function public.fine_workspace(uuid) from public,anon,authenticated;
grant execute on function public.fine_workspace(uuid) to authenticated;

create or replace function public.group_shareout_preview(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare org public.organisation; cyc public.cycle; members jsonb; allocations jsonb; fund numeric; recorded numeric; shares numeric; fine_income numeric;
begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select * into strict org from public.organisation where id=p_org and type='group' and status='active';
 select * into strict cyc from public.cycle where organisation_id=p_org and status='active';
 -- Fail closed if later posting types are introduced without extending this preview.
 if exists(select 1 from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=p_org and a.code not in ('cash','share_capital','social_fund','fines_income')) then raise exception 'Unsupported fund composition' using errcode='22023'; end if;
 select coalesce(sum(case when l.side='debit' then l.amount else -l.amount end),0) into fund
 from public.journal_line l join public.ledger_account a on a.id=l.account_id join public.group_txn t on t.journal_id=l.journal_id join public.meeting m on m.id=t.meeting_id
 where l.organisation_id=p_org and m.cycle_id=cyc.id and a.code='cash';
 select coalesce(sum(t.amount),0),coalesce(sum(t.shares),0) into recorded,shares from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.organisation_id=p_org and m.cycle_id=cyc.id;
 if fund<>recorded or fund<0 or fund>9223372036854775807 or shares<0 then raise exception 'Fund cannot be previewed' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',member_id,'shares',net::text) order by member_id),'[]'::jsonb) into members
 from (select t.member_id,sum(t.shares) as net from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.organisation_id=p_org and m.cycle_id=cyc.id group by t.member_id) w;
 select coalesce(sum(e.cash),0) into recorded from public.fine_event e join public.meeting m on m.id=e.meeting_id where e.organisation_id=p_org and m.cycle_id=cyc.id;
 select coalesce(sum(case when l.side='debit' then l.amount else -l.amount end),0) into fine_income from public.journal_line l join public.ledger_account a on a.id=l.account_id join public.fine_event e on e.journal_id=l.journal_id join public.meeting m on m.id=e.meeting_id where e.organisation_id=p_org and m.cycle_id=cyc.id and a.code='cash';
 if fine_income<>recorded then raise exception 'Fine journal mismatch' using errcode='23514'; end if;
 fund:=fund+fine_income;
 if fund<0 or fund>9223372036854775807 then raise exception 'Invalid distributable fund' using errcode='22023'; end if;
 allocations:=private.shareout_allocation(fund::text,members);
 return jsonb_build_object('cycle_id',cyc.id,'currency',org.currency,'fund',fund::text,'total_shares',shares::text,'calc_version','groups-shareout-preview-v1','scope',case when fine_income=0 then 'recorded-shares-only' else 'recorded-shares-and-paid-fines' end,
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'shares',w->>'shares','amount',a->>'amount') order by p.display_name,p.id) from jsonb_array_elements(members) w join public.person p on p.id=(w->>'id')::uuid join jsonb_array_elements(allocations) a on a->>'id'=w->>'id'),'[]'::jsonb));
end $$;

