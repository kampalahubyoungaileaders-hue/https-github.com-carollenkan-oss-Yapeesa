-- Explicit scheduled Group loans. No lender/SACCO accounting or actual payments.
do $$ begin if not exists(select 1 from pg_roles where rolname='yapesa_loans') then create role yapesa_loans nologin noinherit nobypassrls; end if; end $$;
grant yapesa_loans to postgres;
alter table public.ledger_account drop constraint ledger_account_code_check;
alter table public.ledger_account add constraint ledger_account_code_check check(code in ('cash','share_capital','social_fund','fines_income','loans_receivable','interest_income'));
create table public.loan_policy(id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisation(id),terms jsonb not null check(jsonb_typeof(terms)='object'),entered_by uuid not null references public.person(id),recorded_at timestamptz not null default now(),unique(id,organisation_id));
alter table public.group_settings add column loan_policy_id uuid;
alter table public.group_settings add constraint settings_loan_policy foreign key(loan_policy_id,organisation_id) references public.loan_policy(id,organisation_id);
create table public.loan_request(id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisation(id),meeting_id uuid not null,policy_id uuid not null,member_id uuid not null references public.person(id),principal bigint not null check(principal>0),months bigint not null check(months between 1 and 120),reason text not null check(length(reason) between 1 and 240 and reason ~ '[^[:space:]]'),entered_by uuid not null references public.person(id),device_id uuid not null,recorded_at timestamptz not null default now(),unique(id,organisation_id),foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id),foreign key(policy_id,organisation_id) references public.loan_policy(id,organisation_id),foreign key(device_id,organisation_id) references public.device(id,organisation_id));
create table public.loan_approval(id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisation(id),request_id uuid not null,meeting_id uuid not null,officer_id uuid not null references public.person(id),device_id uuid not null,recorded_at timestamptz not null default now(),unique(request_id,officer_id),foreign key(request_id,organisation_id) references public.loan_request(id,organisation_id),foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id),foreign key(device_id,organisation_id) references public.device(id,organisation_id));
create table public.loan_cancellation(id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisation(id),request_id uuid not null unique,meeting_id uuid not null,member_id uuid not null references public.person(id),reason text not null check(length(reason) between 1 and 240 and reason ~ '[^[:space:]]'),entered_by uuid not null references public.person(id),device_id uuid not null,recorded_at timestamptz not null default now(),foreign key(request_id,organisation_id) references public.loan_request(id,organisation_id),foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id),foreign key(device_id,organisation_id) references public.device(id,organisation_id));
create table public.group_loan(id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisation(id),request_id uuid not null unique,meeting_id uuid not null,member_id uuid not null references public.person(id),schedule jsonb not null check(jsonb_typeof(schedule)='array'),entered_by uuid not null references public.person(id),device_id uuid not null,recorded_at timestamptz not null default now(),calc_version text not null check(calc_version='groups-loans-v1'),unique(id,organisation_id),foreign key(request_id,organisation_id) references public.loan_request(id,organisation_id),foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id),foreign key(device_id,organisation_id) references public.device(id,organisation_id));
create table public.loan_event(id uuid primary key default gen_random_uuid(),revision bigint generated always as identity unique,organisation_id uuid not null references public.organisation(id),loan_id uuid not null,meeting_id uuid not null,member_id uuid not null references public.person(id),kind text not null check(kind in ('disbursement','repayment','reversal')),principal bigint not null,interest bigint not null,cash bigint not null check(cash<>0 and cash::numeric=principal::numeric+interest),allocations jsonb not null check(jsonb_typeof(allocations)='array'),reverses uuid,journal_id uuid not null unique,reason text not null check(length(reason) between 1 and 240 and reason ~ '[^[:space:]]'),entered_by uuid not null references public.person(id),device_id uuid not null,recorded_at timestamptz not null default now(),calc_version text not null check(calc_version='groups-loans-v1'),unique(id,organisation_id),foreign key(loan_id,organisation_id) references public.group_loan(id,organisation_id),foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id),foreign key(journal_id,organisation_id) references public.journal(id,organisation_id),foreign key(device_id,organisation_id) references public.device(id,organisation_id),foreign key(reverses,organisation_id) references public.loan_event(id,organisation_id),check((kind='disbursement' and principal<0 and interest=0 and reverses is null and allocations='[]'::jsonb) or (kind='repayment' and principal>=0 and interest>=0 and cash>0 and reverses is null) or (kind='reversal' and reverses is not null and reverses<>id and ((principal<=0 and interest<=0) or (principal>0 and interest=0)))));
create unique index loan_once on public.loan_event(loan_id) where kind='disbursement';
create unique index loan_one_reversal on public.loan_event(reverses) where reverses is not null;
create index loan_request_member on public.loan_request(member_id,organisation_id);
create index loan_request_meeting on public.loan_request(organisation_id,meeting_id);
create index loan_policy_org on public.loan_policy(organisation_id);
create index loan_approval_org on public.loan_approval(organisation_id,meeting_id);
create index loan_cancellation_org on public.loan_cancellation(organisation_id,meeting_id);
create index loan_book_member on public.group_loan(member_id,organisation_id);
create index loan_book_meeting on public.group_loan(organisation_id,meeting_id);
create index loan_event_loan on public.loan_event(loan_id,revision);
create index loan_event_member on public.loan_event(member_id,organisation_id);
create index loan_event_meeting on public.loan_event(organisation_id,meeting_id);
grant usage on schema public,private,auth to yapesa_loans;
grant usage,select on sequence public.loan_event_revision_seq to yapesa_loans;
grant execute on function private.is_platform_admin(),private.session_active(boolean),private.current_person(),private.has_role(uuid,text[]),private.requires_mfa(),private.can_read_org(uuid),private.is_officer(uuid),private.can_record(uuid),private.person_visible(uuid),private.can_read_journal(uuid),private.meeting_snapshot(uuid,uuid),private.cash_reconciliation(text,text,text,text),private.social_balance(uuid) to yapesa_loans;
grant select on public.person,public.membership,public.organisation,public.group_settings,public.cycle,public.meeting,public.meeting_session,public.device,public.ledger_account,public.journal,public.journal_line,public.group_txn,public.social_txn,public.social_rule,public.social_meeting_policy,public.social_request,public.social_resolution,public.fine_policy,public.fine_meeting_policy,public.fine_charge,public.fine_event,public.meeting_roster,public.attendance,public.sync_receipt to yapesa_loans;
grant insert on public.device,public.journal,public.journal_line,public.meeting_roster,public.sync_receipt,public.audit_log to yapesa_loans;
do $$ declare tbl text; begin
 foreach tbl in array array['loan_policy','loan_request','loan_approval','loan_cancellation','group_loan','loan_event'] loop
  execute format('alter table public.%I enable row level security',tbl);execute format('revoke all on public.%I from public,anon,authenticated',tbl);
  execute format('grant select on public.%I to authenticated,yapesa_loans,yapesa_meetings,yapesa_social,yapesa_fines',tbl);
  execute format('create policy loan_executor_read on public.%I for select to yapesa_loans,yapesa_meetings,yapesa_social,yapesa_fines using(private.is_officer(organisation_id))',tbl);
  execute format('create trigger immutable_record before update or delete on public.%I for each row execute function private.immutable_record()',tbl);
 end loop;
 foreach tbl in array array['loan_request','loan_cancellation','group_loan','loan_event'] loop
  execute format('create policy loan_member_read on public.%I for select to authenticated using(private.can_read_org(organisation_id) and (member_id=private.current_person() or private.is_officer(organisation_id)))',tbl);
 end loop;
 foreach tbl in array array['loan_request','loan_approval','loan_cancellation','group_loan','loan_event'] loop
  execute format('grant insert on public.%I to yapesa_loans',tbl);execute format('create policy loan_executor_insert on public.%I for insert to yapesa_loans with check(private.is_officer(organisation_id))',tbl);
 end loop;
 foreach tbl in array array['person','membership'] loop execute format('create policy loans_lookup on public.%I for select to yapesa_loans using(private.session_active(true))',tbl);end loop;
 foreach tbl in array array['organisation','group_settings','cycle','meeting','meeting_session','device','ledger_account','journal','journal_line','group_txn','social_txn','social_rule','social_meeting_policy','social_request','social_resolution','fine_policy','fine_meeting_policy','fine_charge','fine_event','meeting_roster','attendance','sync_receipt'] loop execute format('create policy loans_read on public.%I for select to yapesa_loans using(private.is_officer(%I))',tbl,case when tbl='organisation' then 'id' else 'organisation_id' end);end loop;
 foreach tbl in array array['device','journal','journal_line','meeting_roster','sync_receipt','audit_log'] loop execute format('create policy loans_insert on public.%I for insert to yapesa_loans with check(private.is_officer(organisation_id))',tbl);end loop;
end $$;
create policy loan_policy_read on public.loan_policy for select to authenticated using(private.can_read_org(organisation_id));
create policy loan_approval_read on public.loan_approval for select to authenticated using(exists(select 1 from public.loan_request r where r.id=request_id));
grant select,insert on public.loan_policy to yapesa_administrator;
grant update(loan_policy_id) on public.group_settings to yapesa_administrator;
create policy admin_loan_policy on public.loan_policy for all to yapesa_administrator using(private.is_platform_admin()) with check(private.is_platform_admin());
create function private.check_loan_policy(p jsonb) returns void language plpgsql immutable security invoker set search_path='' as $$ begin
 if p is null or jsonb_typeof(p)<>'object' or (select count(*) from jsonb_object_keys(p))<>10 or not(p ?& array['monthly_rate_bps','method','multiple','max_months','rounding','allocation','dates','roles','separate','approvals']) then raise exception 'Incomplete loan policy' using errcode='22023'; end if;
 if coalesce(jsonb_typeof(p->'monthly_rate_bps'),'null')<>'string' or p->>'monthly_rate_bps' !~ '^(0|[1-9][0-9]{0,6})$' or (p->>'monthly_rate_bps')::numeric>1000000 or coalesce(jsonb_typeof(p->'multiple'),'null')<>'string' or p->>'multiple' !~ '^[1-9][0-9]{0,18}$' or (p->>'multiple')::numeric>9223372036854775807 or coalesce(jsonb_typeof(p->'max_months'),'null')<>'string' or p->>'max_months' !~ '^[1-9][0-9]{0,2}$' or (p->>'max_months')::numeric>120 or coalesce(p->>'method','') not in ('flat','declining') or coalesce(p->>'rounding','') not in ('down','half_up') or coalesce(p->>'allocation','') not in ('interest_first','principal_first') or coalesce(p->>'dates','') not in ('original_day','month_end') or coalesce(jsonb_typeof(p->'separate'),'null')<>'boolean' or coalesce(p->>'approvals','') not in ('1','2','3') or coalesce(jsonb_typeof(p->'approvals'),'null')<>'string' or coalesce(jsonb_typeof(p->'roles'),'null')<>'array' then raise exception 'Invalid loan policy' using errcode='22023'; end if;
 if jsonb_array_length(p->'roles') not between 1 and 3 or exists(select 1 from jsonb_array_elements(p->'roles') x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('secretary','treasurer','chair')) or (select count(distinct x) from jsonb_array_elements(p->'roles') x)<>jsonb_array_length(p->'roles') then raise exception 'Invalid loan approvers' using errcode='22023'; end if;
end $$;
create function private.loan_schedule(p_principal text,p_start date,p_terms jsonb,p_months text) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare principal numeric; n integer; rate numeric; base numeric; raw_total numeric:=0; total_i numeric; assigned numeric:=0; period integer; part numeric; interest numeric; month_start date; last_day date; due date; rows jsonb:='[]'; begin
 perform private.check_loan_policy(p_terms);
 if p_start is null or p_start<'0001-01-01'::date or p_principal is null or p_principal !~ '^[1-9][0-9]{0,18}$' or p_principal::numeric>9223372036854775807 or p_months is null or p_months !~ '^[1-9][0-9]{0,2}$' or p_months::numeric>(p_terms->>'max_months')::numeric then raise exception 'Invalid loan schedule' using errcode='22023'; end if;
 principal:=p_principal::numeric;n:=p_months::integer;rate:=(p_terms->>'monthly_rate_bps')::numeric;
 if principal<n then raise exception 'Principal must cover every instalment' using errcode='22023'; end if;
 base:=trunc(principal/n);
 for period in 1..n loop raw_total:=raw_total+(case when p_terms->>'method'='flat' then principal else principal-base*(period-1) end)*rate; end loop;
 total_i:=trunc((raw_total+case when p_terms->>'rounding'='half_up' then 5000 else 0 end)/10000);
 if principal+total_i>9223372036854775807 then raise exception 'Loan total overflow' using errcode='22023'; end if;
 for period in 1..n loop
  part:=case when period=n then principal-base*(period-1) else base end;
  interest:=case when period=n then total_i-assigned else trunc((case when p_terms->>'method'='flat' then principal else principal-base*(period-1) end)*rate/10000) end;assigned:=assigned+interest;
  month_start:=(date_trunc('month',p_start)+make_interval(months=>period))::date;last_day:=(month_start+interval '1 month -1 day')::date;
  due:=case when p_terms->>'dates'='month_end' then last_day else month_start+(least(extract(day from p_start),extract(day from last_day))::integer-1) end;
  if due>'9999-12-31'::date then raise exception 'Loan date overflow' using errcode='22023'; end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('period',period::text,'due',due,'principal',part::text,'interest',interest::text));
 end loop;
 return rows;
end $$;
create function private.admin_loan_policy(p_request uuid,p_device uuid,p_org uuid,p_policy jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb; payload jsonb; policy_uuid uuid; begin
 payload:=jsonb_build_object('organisation',p_org,'device',p_device,'policy',p_policy);prior:=private.admin_begin(p_request,'configure_loans',payload);if prior is not null then return prior;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));if not private.is_platform_admin() then raise exception 'Not permitted' using errcode='42501';end if;
 if p_device is null or not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Invalid group' using errcode='22023';end if;
 if p_policy is not null then
  perform private.check_loan_policy(p_policy);insert into public.loan_policy(organisation_id,terms,entered_by) values(p_org,p_policy,private.current_person()) returning id into policy_uuid;
  insert into public.ledger_account(organisation_id,code) values(p_org,'loans_receivable'),(p_org,'interest_income') on conflict do nothing;
 end if;
 update public.group_settings set loan_policy_id=policy_uuid where organisation_id=p_org;
 return private.admin_finish(p_request,'configure_loans',payload,jsonb_build_object('id',p_org),p_org,p_device,coalesce(policy_uuid,p_org));
end $$;
revoke all on function private.check_loan_policy(jsonb),private.loan_schedule(text,date,jsonb,text) from public,anon,authenticated;
grant execute on function private.check_loan_policy(jsonb),private.loan_schedule(text,date,jsonb,text) to authenticated,yapesa_loans,yapesa_administrator;
grant create on schema private to yapesa_administrator;
alter function private.admin_loan_policy(uuid,uuid,uuid,jsonb) owner to yapesa_administrator;
revoke create on schema private from yapesa_administrator;
revoke all on function private.admin_loan_policy(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_loan_policy(uuid,uuid,uuid,jsonb) to authenticated;
create function public.admin_loan_policy(p_request uuid,p_device uuid,p_org uuid,p_policy jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_loan_policy(p_request,p_device,p_org,p_policy); $$;
revoke all on function public.admin_loan_policy(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_loan_policy(uuid,uuid,uuid,jsonb) to authenticated;
create function private.loan_eligible(p_request uuid,p_person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.loan_request r join public.loan_policy p on p.id=r.policy_id join public.membership m on m.organisation_id=r.organisation_id and m.person_id=p_person where r.id=p_request and private.can_read_org(r.organisation_id) and (r.member_id=private.current_person() or private.is_officer(r.organisation_id)) and (p_person=private.current_person() or exists(select 1 from public.loan_approval a where a.request_id=r.id and a.officer_id=p_person)) and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()) and m.role in(select jsonb_array_elements_text(p.terms->'roles')) and (not(p.terms->>'separate')::boolean or p_person<>r.entered_by));
$$;
create function private.loan_borrowable(p_org uuid,p_member uuid,p_terms jsonb) returns numeric language sql stable security invoker set search_path='' as $$
 select greatest(0,least(9223372036854775807::numeric,
 coalesce((select sum(t.amount) from public.group_txn t join public.meeting m on m.id=t.meeting_id join public.cycle c on c.id=m.cycle_id where t.organisation_id=p_org and t.member_id=p_member and c.status='active'),0)*(p_terms->>'multiple')::numeric
 +coalesce((select sum(e.principal) from public.loan_event e where e.organisation_id=p_org and e.member_id=p_member),0)));
$$;
create function private.loan_cash(p_org uuid,p_meeting uuid) returns numeric language plpgsql stable security definer set search_path='' as $$
declare recorded numeric; reserve numeric; expected numeric;begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501';end if;
 select coalesce(sum(case when l.side='debit' then l.amount else -l.amount end),0) into recorded from public.journal_line l join public.ledger_account a on a.id=l.account_id where a.organisation_id=p_org and a.code='cash';
 reserve:=private.social_balance(p_org);if exists(select 1 from public.meeting_session where meeting_id=p_meeting) then expected:=(private.meeting_snapshot(p_org,p_meeting)->>'expected_cash')::numeric;else expected:=recorded;end if;
 if recorded<0 or recorded>9223372036854775807 then raise exception 'Invalid recorded cash' using errcode='22023';end if;
 return least(recorded-reserve,expected-reserve);
end $$;
create function private.loan_allocate(p_loan uuid,p_amount text,p_order text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare remaining numeric; part jsonb; paid_p numeric; paid_i numeric; due_p numeric; due_i numeric; take_p numeric; take_i numeric; rows jsonb:='[]';begin
 if p_amount is null or p_amount !~ '^[1-9][0-9]{0,18}$' or p_amount::numeric>9223372036854775807 or p_order is null or p_order not in ('interest_first','principal_first') then raise exception 'Invalid repayment' using errcode='22023';end if;
 remaining:=p_amount::numeric;
 for part in select jsonb_array_elements(schedule) from public.group_loan where id=p_loan loop
  select coalesce(sum((a->>'principal')::numeric*case when e.cash>0 then 1 else -1 end),0),coalesce(sum((a->>'interest')::numeric*case when e.cash>0 then 1 else -1 end),0) into paid_p,paid_i from public.loan_event e cross join lateral jsonb_array_elements(e.allocations) a where e.loan_id=p_loan and a->>'period'=part->>'period';
  due_p:=(part->>'principal')::numeric-paid_p;due_i:=(part->>'interest')::numeric-paid_i;
  if paid_p<0 or paid_i<0 or due_p<0 or due_i<0 then raise exception 'Invalid loan balance' using errcode='23514';end if;
  if p_order='interest_first' then take_i:=least(remaining,due_i);remaining:=remaining-take_i;take_p:=least(remaining,due_p);remaining:=remaining-take_p;
  else take_p:=least(remaining,due_p);remaining:=remaining-take_p;take_i:=least(remaining,due_i);remaining:=remaining-take_i;end if;
  if take_p+take_i>0 then rows:=rows||jsonb_build_array(jsonb_build_object('period',part->>'period','principal',take_p::text,'interest',take_i::text));end if;
 end loop;
 if remaining<>0 then raise exception 'Repayment exceeds loan balance' using errcode='22023';end if;return rows;
end $$;
revoke all on function private.loan_eligible(uuid,uuid),private.loan_borrowable(uuid,uuid,jsonb),private.loan_cash(uuid,uuid),private.loan_allocate(uuid,text,text) from public,anon,authenticated;
grant execute on function private.loan_eligible(uuid,uuid),private.loan_borrowable(uuid,uuid,jsonb),private.loan_cash(uuid,uuid),private.loan_allocate(uuid,text,text) to authenticated,yapesa_loans;
grant create on schema private to yapesa_loans;
alter function private.loan_cash(uuid,uuid) owner to yapesa_loans;
revoke create on schema private from yapesa_loans;
-- Former borrowers settling an existing obligation are not enrolled for new social dues.
create function private.guard_loan_activity() returns trigger language plpgsql security invoker set search_path='' as $$
declare target public.meeting;boundary date;begin
 perform pg_advisory_xact_lock(hashtextextended(new.organisation_id::text,0));
 select * into strict target from public.meeting where id=new.meeting_id and organisation_id=new.organisation_id;
 select max(m.meeting_date) into boundary from public.meeting m where m.organisation_id=new.organisation_id and (m.status='closed' or exists(select 1 from public.meeting_session s where s.meeting_id=m.id));
 if target.status<>'open' or target.meeting_date<boundary or not exists(select 1 from public.meeting_session where meeting_id=target.id) then raise exception 'Meeting history is locked' using errcode='22023';end if;
 if tg_table_name in ('loan_request','loan_event') then if exists(select 1 from public.membership where organisation_id=new.organisation_id and person_id=new.member_id and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) then insert into public.meeting_roster(organisation_id,meeting_id,member_id) values(new.organisation_id,new.meeting_id,new.member_id) on conflict do nothing;end if;end if;
 return new;
end $$;
revoke all on function private.guard_loan_activity() from public,anon,authenticated;
do $$ declare tbl text;begin foreach tbl in array array['loan_request','loan_approval','loan_cancellation','group_loan','loan_event'] loop execute format('create trigger guard_loan_activity before insert on public.%I for each row execute function private.guard_loan_activity()',tbl);end loop;end $$;
create function public.loan_quote(p_org uuid,p_member uuid,p_meeting uuid,p_principal text,p_months text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare policy public.loan_policy;start_date date;rows jsonb;begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501';end if;
 select p.* into strict policy from public.group_settings s join public.loan_policy p on p.id=s.loan_policy_id where s.organisation_id=p_org;
 select m.meeting_date into strict start_date from public.meeting m join public.cycle c on c.id=m.cycle_id join public.meeting_session s on s.meeting_id=m.id where m.id=p_meeting and m.organisation_id=p_org and m.status='open' and c.status='active';
 if not exists(select 1 from public.membership where organisation_id=p_org and person_id=p_member and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'Active borrower required' using errcode='22023';end if;
 rows:=private.loan_schedule(p_principal,start_date,policy.terms,p_months);
 return jsonb_build_object('policy_id',policy.id,'terms',policy.terms,'currency',(select currency from public.organisation where id=p_org),'start',start_date,'principal',p_principal,'months',p_months,'schedule',rows,'borrowable',private.loan_borrowable(p_org,p_member,policy.terms)::text,'available_cash',greatest(0,private.loan_cash(p_org,p_meeting))::text);
end $$;
revoke all on function public.loan_quote(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.loan_quote(uuid,uuid,uuid,text,text) to authenticated;
create function private.loan_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_meeting uuid,p_member uuid,p_amount text,p_months text,p_policy uuid,p_reason text,p_target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;prior public.sync_receipt;payload jsonb;result_data jsonb;meet public.meeting;req public.loan_request;policy public.loan_policy;book public.group_loan;original public.loan_event;record_uuid uuid:=gen_random_uuid();event_uuid uuid;journal_uuid uuid;rows jsonb:='[]';schedule_rows jsonb;part_p bigint:=0;part_i bigint:=0;cash bigint;begin
 if p_action is null or p_action not in ('request','approve','cancel','disburse','repay','reverse') or not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not private.is_officer(p_org) or (p_action<>'approve' and not private.can_record(p_org)) then raise exception 'Not permitted' using errcode='42501';end if;actor:=private.current_person();
 if p_request is null or p_request::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or p_device is null or p_reason is null or length(p_reason)>240 or (p_action<>'approve' and p_reason !~ '[^[:space:]]') or (p_action='approve' and p_reason<>'') then raise exception 'Invalid loan command' using errcode='22023';end if;
 payload:=jsonb_build_object('actor',actor,'action',p_action,'device',p_device,'meeting',p_meeting,'member',p_member,'amount',p_amount,'months',p_months,'policy',p_policy,'reason',p_reason,'target',p_target);
 select * into prior from public.sync_receipt where client_id=p_request;
 if found then if prior.organisation_id<>p_org or prior.request<>payload then raise exception 'Idempotency conflict' using errcode='23505';end if;return prior.result;end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Inactive group' using errcode='22023';end if;
 if p_action<>'approve' and (select writer_device_id from public.group_settings where organisation_id=p_org) is distinct from p_device then raise exception 'Writer device required' using errcode='42501';end if;
 if not exists(select 1 from public.device where id=p_device and organisation_id=p_org) then insert into public.device(id,organisation_id,registered_by) values(p_device,p_org,actor);end if;
 select * into strict meet from public.meeting where id=p_meeting and organisation_id=p_org;
 if meet.status<>'open' or not exists(select 1 from public.meeting_session where meeting_id=meet.id) or not exists(select 1 from public.cycle where id=meet.cycle_id and status='active') then raise exception 'Open meeting required' using errcode='22023';end if;
 if p_action='request' then
  if p_member is null or p_policy is null or p_target is not null then raise exception 'Borrower and quoted policy required' using errcode='22023';end if;
  select p.* into strict policy from public.group_settings s join public.loan_policy p on p.id=s.loan_policy_id where s.organisation_id=p_org and p.id=p_policy;
  perform private.loan_schedule(p_amount,meet.meeting_date,policy.terms,p_months);
  if not exists(select 1 from public.membership where organisation_id=p_org and person_id=p_member and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) or p_amount::numeric>private.loan_borrowable(p_org,p_member,policy.terms) then raise exception 'Borrower loan limit exceeded' using errcode='22023';end if;
  insert into public.loan_request(id,organisation_id,meeting_id,policy_id,member_id,principal,months,reason,entered_by,device_id) values(record_uuid,p_org,meet.id,policy.id,p_member,p_amount::bigint,p_months::bigint,p_reason,actor,p_device);
 else
  if p_target is null or p_member is not null or p_policy is not null or p_months is not null or (p_action<>'repay' and p_amount is not null) then raise exception 'Invalid loan target action' using errcode='22023';end if;
  if p_action in ('approve','cancel','disburse') then
   select * into strict req from public.loan_request where id=p_target and organisation_id=p_org;
   select * into strict policy from public.loan_policy where id=req.policy_id;
   if exists(select 1 from public.loan_cancellation where request_id=req.id) or exists(select 1 from public.group_loan where request_id=req.id) then raise exception 'Loan request already resolved' using errcode='23505';end if;
   if (select cycle_id from public.meeting where id=req.meeting_id)<>meet.cycle_id then raise exception 'Loan request belongs to another cycle' using errcode='22023';end if;
   if p_action='approve' then
    if not private.loan_eligible(req.id,actor) then raise exception 'Configured independent group officer required' using errcode='42501';end if;
    insert into public.loan_approval(id,organisation_id,request_id,meeting_id,officer_id,device_id) values(record_uuid,p_org,req.id,meet.id,actor,p_device);
   elsif p_action='cancel' then insert into public.loan_cancellation(id,organisation_id,request_id,meeting_id,member_id,reason,entered_by,device_id) values(record_uuid,p_org,req.id,meet.id,req.member_id,p_reason,actor,p_device);
   else
    if (select count(*) from public.loan_approval a where request_id=req.id and private.loan_eligible(req.id,a.officer_id))<(policy.terms->>'approvals')::bigint then raise exception 'Required loan approvals missing' using errcode='22023';end if;
    if not exists(select 1 from public.membership where organisation_id=p_org and person_id=req.member_id and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) or req.principal>private.loan_borrowable(p_org,req.member_id,policy.terms) then raise exception 'Borrower loan limit exceeded' using errcode='22023';end if;
    if req.principal>private.loan_cash(p_org,meet.id) then raise exception 'Insufficient loan fund cash' using errcode='22023';end if;
    schedule_rows:=private.loan_schedule(req.principal::text,meet.meeting_date,policy.terms,req.months::text);
    insert into public.group_loan(id,organisation_id,request_id,meeting_id,member_id,schedule,entered_by,device_id,calc_version) values(record_uuid,p_org,req.id,meet.id,req.member_id,schedule_rows,actor,p_device,'groups-loans-v1') returning * into book;
    part_p:=-req.principal;event_uuid:=gen_random_uuid();
   end if;
  else
   if p_action='reverse' then
    select * into strict original from public.loan_event where id=p_target and organisation_id=p_org and meeting_id=meet.id and kind<>'reversal';
    if exists(select 1 from public.loan_event where reverses=original.id) then raise exception 'Already reversed' using errcode='23505';end if;
    select * into strict book from public.group_loan where id=original.loan_id and organisation_id=p_org;
    if original.kind='disbursement' and coalesce((select sum(e.cash) from public.loan_event e left join public.loan_event o on o.id=e.reverses where e.loan_id=book.id and (e.kind='repayment' or o.kind='repayment')),0)<>0 then raise exception 'Reverse repayments first' using errcode='22023';end if;
    part_p:=-original.principal;part_i:=-original.interest;rows:=original.allocations;
   else
    select * into strict book from public.group_loan where id=p_target and organisation_id=p_org;
    if exists(select 1 from public.loan_event e join public.loan_event o on o.id=e.reverses where e.loan_id=book.id and o.kind='disbursement') then raise exception 'Disbursement was reversed' using errcode='22023';end if;
    select r.* into strict req from public.loan_request r where r.id=book.request_id;
    select * into strict policy from public.loan_policy where id=req.policy_id;
    rows:=private.loan_allocate(book.id,p_amount,policy.terms->>'allocation');
    select sum((x->>'principal')::numeric)::bigint,sum((x->>'interest')::numeric)::bigint into part_p,part_i from jsonb_array_elements(rows) x;
   end if;
   event_uuid:=record_uuid;
  end if;
  if event_uuid is not null then
   cash:=(part_p::numeric+part_i)::bigint;
   if cash<0 and -cash::numeric>private.loan_cash(p_org,meet.id) then raise exception 'Insufficient loan fund cash' using errcode='22023';end if;
   journal_uuid:=gen_random_uuid();
   insert into public.journal(id,organisation_id,currency,calc_version) select journal_uuid,p_org,currency,'groups-loans-v1' from public.organisation where id=p_org;
   if p_action='reverse' then insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select p_org,journal_uuid,account_id,case when side='debit' then 'credit' else 'debit' end,amount from public.journal_line where journal_id=original.journal_id;
   else
    insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select p_org,journal_uuid,id,case when cash>0 then 'debit' else 'credit' end,abs(cash) from public.ledger_account where organisation_id=p_org and code='cash';
    insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select p_org,journal_uuid,id,case when value>0 then 'credit' else 'debit' end,abs(value) from public.ledger_account a cross join lateral(select case when a.code='loans_receivable' then part_p else part_i end as value) w where organisation_id=p_org and code in ('loans_receivable','interest_income') and value<>0;
   end if;
   if (select count(*) from public.journal_line where journal_id=journal_uuid)<>(case when part_p=0 or part_i=0 then 2 else 3 end) then raise exception 'Loan accounts incomplete' using errcode='23514';end if;
   insert into public.loan_event(id,organisation_id,loan_id,meeting_id,member_id,kind,principal,interest,cash,allocations,reverses,journal_id,reason,entered_by,device_id,calc_version) values(event_uuid,p_org,book.id,meet.id,book.member_id,case p_action when 'disburse' then 'disbursement' when 'repay' then 'repayment' else 'reversal' end,part_p,part_i,cash,rows,case when p_action='reverse' then original.id else null end,journal_uuid,p_reason,actor,p_device,'groups-loans-v1');
  end if;
 end if;
 result_data:=jsonb_build_object('id',record_uuid);insert into public.sync_receipt(client_id,organisation_id,request,result) values(p_request,p_org,payload,result_data);
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(p_org,actor,p_device,'loan_'||p_action,record_uuid,payload||result_data);return result_data;
end $$;
grant create on schema private to yapesa_loans;
alter function private.loan_command(uuid,text,uuid,uuid,uuid,uuid,text,text,uuid,text,uuid) owner to yapesa_loans;
revoke create on schema private from yapesa_loans;
revoke all on function private.loan_command(uuid,text,uuid,uuid,uuid,uuid,text,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.loan_command(uuid,text,uuid,uuid,uuid,uuid,text,text,uuid,text,uuid) to authenticated;
create function public.loan_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_meeting uuid,p_member uuid default null,p_amount text default null,p_months text default null,p_policy uuid default null,p_reason text default '',p_target uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.loan_command(p_org,p_action,p_request,p_device,p_meeting,p_member,p_amount,p_months,p_policy,p_reason,p_target); $$;
revoke all on function public.loan_command(uuid,text,uuid,uuid,uuid,uuid,text,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.loan_command(uuid,text,uuid,uuid,uuid,uuid,text,text,uuid,text,uuid) to authenticated;

create or replace function private.meeting_snapshot(p_org uuid,p_meeting uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare opening numeric; cash_in numeric; cash_out numeric; expected numeric; roster jsonb; transactions jsonb; snapshot jsonb; begin
 select opening_cash into strict opening from public.meeting_session where organisation_id=p_org and meeting_id=p_meeting;
 select coalesce(sum(l.amount) filter(where l.side='debit'),0),coalesce(sum(l.amount) filter(where l.side='credit'),0) into cash_in,cash_out
 from public.journal_line l join public.ledger_account a on a.id=l.account_id join (select journal_id,meeting_id,organisation_id from public.group_txn union all select journal_id,meeting_id,organisation_id from public.social_txn union all select journal_id,meeting_id,organisation_id from public.fine_event where journal_id is not null union all select journal_id,meeting_id,organisation_id from public.loan_event) t on t.journal_id=l.journal_id where t.meeting_id=p_meeting and t.organisation_id=p_org and a.code='cash';
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
 if exists(select 1 from public.loan_request where meeting_id=p_meeting) or exists(select 1 from public.loan_approval where meeting_id=p_meeting) or exists(select 1 from public.loan_cancellation where meeting_id=p_meeting) or exists(select 1 from public.loan_event where meeting_id=p_meeting) then
 snapshot:=snapshot||jsonb_build_object('loan_requests',coalesce((select jsonb_agg(id order by id) from public.loan_request where meeting_id=p_meeting),'[]'::jsonb),'loan_approvals',coalesce((select jsonb_agg(id order by id) from public.loan_approval where meeting_id=p_meeting),'[]'::jsonb),'loan_cancellations',coalesce((select jsonb_agg(id order by id) from public.loan_cancellation where meeting_id=p_meeting),'[]'::jsonb),'loan_events',coalesce((select jsonb_agg(id order by id) from public.loan_event where meeting_id=p_meeting),'[]'::jsonb));
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
 or exists(select 1 from public.fine_charge s where s.member_id=p_person and private.is_officer(s.organisation_id))
 or exists(select 1 from public.loan_request s where s.member_id=p_person and private.is_officer(s.organisation_id)));
$$;


create or replace function private.can_read_journal(p_journal uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
 exists(select 1 from public.group_txn t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id)))
 or exists(select 1 from public.social_txn t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id)))
 or exists(select 1 from public.fine_event t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id)))
 or exists(select 1 from public.loan_event t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id))));
$$;

grant select on public.loan_request to yapesa_administrator;
create policy loan_admin_request_read on public.loan_request for select to yapesa_administrator using(private.is_platform_admin());
create or replace function private.admin_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_platform_admin() then raise exception 'Verified platform administrator required' using errcode='42501'; end if;
 return jsonb_build_object(
 'currencies',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'minor_digits',minor_digits) order by code),'[]') from public.currency_reference),
 'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name,'phone',phone,'has_login',auth_user_id is not null,'staff_ready',private.staff_ready(id)) order by display_name),'[]') from public.person),
 'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'country_code',o.country_code,'currency',o.currency,'time_zone',o.time_zone,'max_shares',gs.max_shares_per_meeting::text,
 'configuration_locked',exists(select 1 from public.group_txn t where t.organisation_id=o.id) or exists(select 1 from public.social_txn t where t.organisation_id=o.id) or exists(select 1 from public.fine_charge t where t.organisation_id=o.id) or exists(select 1 from public.loan_request t where t.organisation_id=o.id),
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
 if exists(select 1 from public.group_txn where organisation_id=p_org) or exists(select 1 from public.social_txn where organisation_id=p_org) or exists(select 1 from public.fine_charge where organisation_id=p_org) or exists(select 1 from public.loan_request where organisation_id=p_org) then raise exception 'Posted configuration is locked' using errcode='22023'; end if;
 update public.organisation set name=btrim(p_name) where id=p_org;
 update public.group_settings set max_shares_per_meeting=p_max::bigint where organisation_id=p_org;
 if exists(select 1 from public.cycle where organisation_id=p_org and status='active' and share_price<>p_price::bigint) then raise exception 'Cycle share price is fixed' using errcode='22023'; end if;
 update public.cycle set starts_on=p_starts,ends_on=p_ends where organisation_id=p_org and status='active';
 if not found then insert into public.cycle(organisation_id,starts_on,ends_on,share_price) values(p_org,p_starts,p_ends,p_price::bigint); end if;
 return private.admin_finish(p_request,'configure_group',payload,jsonb_build_object('id',p_org),p_org,p_device,p_org);
end $$;

-- A loan, share correction or fine refund must not consume the social reserve.
create function private.guard_loan_cash() returns trigger language plpgsql security definer set search_path='' as $$
declare movement bigint;available numeric;begin
 if not private.can_record(new.organisation_id) then raise exception 'Not permitted' using errcode='42501';end if;
 if tg_table_name='group_txn' then movement:=new.amount;else movement:=new.cash;end if;
 if movement<0 or tg_table_name='loan_event' then available:=private.loan_cash(new.organisation_id,new.meeting_id);if available<0 then raise exception 'Cash is reserved for the social fund' using errcode='22023';end if;end if;return new;
end $$;
grant create on schema private to yapesa_loans;
alter function private.guard_loan_cash() owner to yapesa_loans;
revoke create on schema private from yapesa_loans;
revoke all on function private.guard_loan_cash() from public,anon,authenticated;
create trigger protect_loan_social_cash after insert on public.loan_event for each row execute function private.guard_loan_cash();
create trigger protect_share_social_cash after insert on public.group_txn for each row execute function private.guard_loan_cash();
create trigger protect_fine_social_cash after insert on public.fine_event for each row execute function private.guard_loan_cash();
create function public.loan_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not private.can_read_org(p_org) then raise exception 'Not permitted' using errcode='42501';end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Inactive group' using errcode='22023';end if;
 return jsonb_build_object('currency',(select currency from public.organisation where id=p_org),'can_record',private.can_record(p_org),'can_configure',private.is_platform_admin(),
 'policy',(select jsonb_build_object('id',p.id,'terms',p.terms) from public.group_settings g join public.loan_policy p on p.id=g.loan_policy_id where g.organisation_id=p_org),
 'meetings',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'date',m.meeting_date,'status',m.status,'ready',exists(select 1 from public.meeting_session where meeting_id=m.id),'available_cash',case when private.is_officer(p_org) and m.status='open' and exists(select 1 from public.meeting_session where meeting_id=m.id) then greatest(0,private.loan_cash(p_org,m.id))::text else null end) order by m.meeting_date desc,m.id) from public.meeting m where m.organisation_id=p_org),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'meeting_id',r.meeting_id,'member_id',r.member_id,'name',u.display_name,'principal',r.principal::text,'months',r.months::text,'policy_id',r.policy_id,'terms',p.terms,'reason',r.reason,'entered_by',r.entered_by,'date',m.meeting_date,'cancelled',exists(select 1 from public.loan_cancellation where request_id=r.id),'loan_id',(select id from public.group_loan where request_id=r.id),'can_approve',private.is_officer(p_org) and private.loan_eligible(r.id,private.current_person()) and not exists(select 1 from public.loan_approval where request_id=r.id and officer_id=private.current_person()),'approvals',coalesce((select jsonb_agg(jsonb_build_object('person_id',a.officer_id,'eligible',private.loan_eligible(r.id,a.officer_id)) order by a.recorded_at,a.id) from public.loan_approval a where a.request_id=r.id),'[]'::jsonb)) order by r.recorded_at desc,r.id) from public.loan_request r join public.loan_policy p on p.id=r.policy_id join public.person u on u.id=r.member_id join public.meeting m on m.id=r.meeting_id where r.organisation_id=p_org),'[]'::jsonb),
 'loans',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'request_id',g.request_id,'meeting_id',g.meeting_id,'member_id',g.member_id,'name',p.display_name,'date',m.meeting_date,'schedule',g.schedule,'calc_version',g.calc_version) order by g.recorded_at desc,g.id) from public.group_loan g join public.person p on p.id=g.member_id join public.meeting m on m.id=g.meeting_id where g.organisation_id=p_org),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'revision',e.revision::text,'loan_id',e.loan_id,'meeting_id',e.meeting_id,'date',m.meeting_date,'kind',e.kind,'principal',e.principal::text,'interest',e.interest::text,'cash',e.cash::text,'allocations',e.allocations,'reverses',e.reverses,'journal_id',e.journal_id,'reason',e.reason,'journal',coalesce((select jsonb_agg(jsonb_build_object('account',a.code,'side',l.side,'amount',l.amount::text) order by a.code) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.journal_id=e.journal_id),'[]'::jsonb)) order by e.revision) from public.loan_event e join public.meeting m on m.id=e.meeting_id where e.organisation_id=p_org),'[]'::jsonb));
end $$;
revoke all on function public.loan_workspace(uuid) from public,anon,authenticated;
grant execute on function public.loan_workspace(uuid) to authenticated;

create or replace function public.group_shareout_preview(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare org public.organisation; cyc public.cycle; members jsonb; allocations jsonb; fund numeric; recorded numeric; shares numeric; fine_income numeric; loan_income numeric; outstanding numeric;
begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select * into strict org from public.organisation where id=p_org and type='group' and status='active';
 select * into strict cyc from public.cycle where organisation_id=p_org and status='active';
 -- Fail closed if later posting types are introduced without extending this preview.
 if exists(select 1 from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=p_org and a.code not in ('cash','share_capital','social_fund','fines_income','loans_receivable','interest_income')) then raise exception 'Unsupported fund composition' using errcode='22023'; end if;
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
 select coalesce(sum(e.interest),0) into recorded from public.loan_event e join public.meeting m on m.id=e.meeting_id where e.organisation_id=p_org and m.cycle_id=cyc.id;
 select coalesce(sum(case when l.side='credit' then l.amount else -l.amount end),0) into loan_income from public.journal_line l join public.ledger_account a on a.id=l.account_id join public.loan_event e on e.journal_id=l.journal_id join public.meeting m on m.id=e.meeting_id where e.organisation_id=p_org and m.cycle_id=cyc.id and a.code='interest_income';
 if recorded<>loan_income then raise exception 'Loan interest journal mismatch' using errcode='23514';end if;
 select -coalesce(sum(principal),0) into outstanding from public.loan_event where organisation_id=p_org;
 if outstanding<0 or outstanding>9223372036854775807 then raise exception 'Invalid loan receivable' using errcode='23514';end if;
 if outstanding<>(select coalesce(sum(case when l.side='debit' then l.amount else -l.amount end),0) from public.journal_line l join public.ledger_account a on a.id=l.account_id where a.organisation_id=p_org and a.code='loans_receivable') then raise exception 'Principal journal mismatch' using errcode='23514';end if;
 fund:=fund+fine_income+loan_income;
 if fund<0 or fund>9223372036854775807 then raise exception 'Invalid distributable fund' using errcode='22023'; end if;
 allocations:=private.shareout_allocation(fund::text,members);
 return jsonb_build_object('cycle_id',cyc.id,'currency',org.currency,'fund',fund::text,'total_shares',shares::text,'calc_version','groups-shareout-preview-v1','scope',case when loan_income<>0 then 'recorded-shares-fines-and-loan-interest' when fine_income=0 then 'recorded-shares-only' else 'recorded-shares-and-paid-fines' end,'loans_outstanding',outstanding::text,
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'shares',w->>'shares','amount',a->>'amount') order by p.display_name,p.id) from jsonb_array_elements(members) w join public.person p on p.id=(w->>'id')::uuid join jsonb_array_elements(allocations) a on a->>'id'=w->>'id'),'[]'::jsonb));
end $$;

