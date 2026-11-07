-- Social money has its own append-only records and liability account. Share
-- purchases/passbooks remain separate, and social money is excluded from share-out.
do $$ begin if not exists(select 1 from pg_roles where rolname='yapesa_social') then create role yapesa_social nologin noinherit nobypassrls; end if; end $$;
grant yapesa_social to postgres;
alter table public.ledger_account drop constraint ledger_account_code_check;
alter table public.ledger_account add constraint ledger_account_code_check check(code in ('cash','share_capital','social_fund'));
create table public.social_rule(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), contribution bigint not null check(contribution>0),
 approver_roles text[] not null check(cardinality(approver_roles)>0 and approver_roles<@array['secretary','treasurer','chair']::text[] and array_position(approver_roles,null) is null),
 separate_approver boolean not null, require_all boolean not null, entered_by uuid not null references public.person(id), recorded_at timestamptz not null default now(), unique(id,organisation_id)
);
alter table public.group_settings add column social_rule_id uuid;
alter table public.group_settings add constraint settings_social_rule foreign key(social_rule_id,organisation_id) references public.social_rule(id,organisation_id);
create table public.social_meeting_policy(
 meeting_id uuid primary key, organisation_id uuid not null references public.organisation(id), rule_id uuid not null,
 foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id), foreign key(rule_id,organisation_id) references public.social_rule(id,organisation_id), unique(meeting_id,rule_id,organisation_id)
);
create table public.social_request(
 id uuid primary key default gen_random_uuid(), revision bigint generated always as identity unique, organisation_id uuid not null references public.organisation(id), meeting_id uuid not null, rule_id uuid not null,
 member_id uuid not null references public.person(id), kind text not null check(kind in ('grant','reversal')), cash bigint not null check(cash<>0), target_id uuid,
 reason text not null check(length(reason) between 1 and 240 and reason ~ '[^[:space:]]'), entered_by uuid not null references public.person(id), device_id uuid not null,
 recorded_at timestamptz not null default now(), unique(id,organisation_id), foreign key(meeting_id,rule_id,organisation_id) references public.social_meeting_policy(meeting_id,rule_id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id),
 check((kind='grant' and cash<0 and target_id is null) or (kind='reversal' and target_id is not null))
);
create table public.social_txn(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), meeting_id uuid not null, rule_id uuid not null, member_id uuid not null references public.person(id),
 kind text not null check(kind in ('contribution','grant','reversal')), cash bigint not null check(cash<>0), reverses uuid, request_id uuid unique,
 journal_id uuid not null unique, entered_by uuid not null references public.person(id), device_id uuid not null, note text not null check(length(note)<=240), calc_version text not null check(calc_version='groups-social-v1'), recorded_at timestamptz not null default now(),
 unique(id,organisation_id), foreign key(meeting_id,rule_id,organisation_id) references public.social_meeting_policy(meeting_id,rule_id,organisation_id), foreign key(journal_id,organisation_id) references public.journal(id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id),
 foreign key(reverses,organisation_id) references public.social_txn(id,organisation_id), foreign key(request_id,organisation_id) references public.social_request(id,organisation_id),
 check((kind='contribution' and cash>0 and reverses is null and request_id is null) or (kind='grant' and cash<0 and reverses is null and request_id is not null) or (kind='reversal' and reverses is not null and reverses<>id and request_id is not null))
);
create unique index social_one_reversal on public.social_txn(reverses) where reverses is not null;
alter table public.social_request add constraint social_request_target foreign key(target_id,organisation_id) references public.social_txn(id,organisation_id);
create table public.social_resolution(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), request_id uuid not null unique,
 outcome text not null check(outcome in ('approved','cancelled')), actor_id uuid not null references public.person(id), device_id uuid not null, recorded_at timestamptz not null default now(),
 foreign key(request_id,organisation_id) references public.social_request(id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id)
);
create index social_rule_org on public.social_rule(organisation_id);
create index social_policy_org on public.social_meeting_policy(organisation_id,meeting_id);
create index social_txn_meeting_member on public.social_txn(organisation_id,meeting_id,member_id);
create index social_txn_member on public.social_txn(member_id,organisation_id);
create index social_request_meeting on public.social_request(organisation_id,meeting_id);
create index social_request_member on public.social_request(member_id,organisation_id);
create index social_request_target on public.social_request(target_id);
create index social_resolution_org on public.social_resolution(organisation_id,request_id);

grant usage on schema public,private,auth to yapesa_social;
grant execute on function private.is_platform_admin(),private.session_active(boolean),private.current_person(),private.has_role(uuid,text[]),private.requires_mfa(),private.can_read_org(uuid),private.is_officer(uuid),private.can_record(uuid),private.person_visible(uuid),private.can_read_journal(uuid),private.meeting_snapshot(uuid,uuid),private.cash_reconciliation(text,text,text,text) to yapesa_social;
grant usage,select on sequence public.social_request_revision_seq to yapesa_social;
grant select on public.person,public.membership,public.organisation,public.group_settings,public.cycle,public.meeting,public.meeting_session,public.device,public.ledger_account,public.journal,public.journal_line,public.group_txn,public.meeting_roster,public.attendance,public.sync_receipt to yapesa_social;
grant insert on public.device,public.journal,public.journal_line,public.meeting_roster,public.sync_receipt,public.audit_log to yapesa_social;
do $$ declare tbl text; begin
 foreach tbl in array array['social_rule','social_meeting_policy','social_request','social_txn','social_resolution'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated',tbl);
  execute format('grant select on public.%I to authenticated,yapesa_social,yapesa_meetings',tbl);
  execute format('create policy social_executor_read on public.%I for select to yapesa_social,yapesa_meetings using(private.is_officer(organisation_id))',tbl);
  execute format('create trigger immutable_record before update or delete on public.%I for each row execute function private.immutable_record()',tbl);
 end loop;
 foreach tbl in array array['social_rule','social_meeting_policy'] loop execute format('create policy social_rule_read on public.%I for select to authenticated using(private.can_read_org(organisation_id))',tbl); end loop;
 foreach tbl in array array['social_request','social_txn'] loop
  execute format('create policy social_member_read on public.%I for select to authenticated using(private.can_read_org(organisation_id) and (member_id=private.current_person() or private.is_officer(organisation_id)))',tbl);
 end loop;
 foreach tbl in array array['social_meeting_policy','social_request','social_txn','social_resolution'] loop
  execute format('grant insert on public.%I to yapesa_social',tbl);
  execute format('create policy social_executor_insert on public.%I for insert to yapesa_social with check(private.is_officer(organisation_id))',tbl);
 end loop;
 foreach tbl in array array['person','membership'] loop execute format('create policy social_lookup on public.%I for select to yapesa_social using(private.session_active(true))',tbl); end loop;
 foreach tbl in array array['organisation','group_settings','cycle','meeting','meeting_session','device','ledger_account','journal','journal_line','group_txn','meeting_roster','attendance','sync_receipt'] loop
  execute format('create policy social_read on public.%I for select to yapesa_social using(private.is_officer(%I))',tbl,case when tbl='organisation' then 'id' else 'organisation_id' end);
 end loop;
 foreach tbl in array array['device','journal','journal_line','meeting_roster','sync_receipt','audit_log'] loop execute format('create policy social_insert on public.%I for insert to yapesa_social with check(private.is_officer(organisation_id))',tbl); end loop;
end $$;
create policy social_resolution_read on public.social_resolution for select to authenticated using(exists(select 1 from public.social_request r where r.id=request_id));
grant select,insert on public.social_rule to yapesa_administrator;
grant update(social_rule_id) on public.group_settings to yapesa_administrator;
create policy admin_social_rule on public.social_rule for all to yapesa_administrator using(private.is_platform_admin()) with check(private.is_platform_admin());
-- Opening a meeting freezes an explicitly configured rule; no rule is invented.
grant insert on public.social_meeting_policy to yapesa_meetings;
create policy meeting_social_insert on public.social_meeting_policy for insert to yapesa_meetings with check(private.can_record(organisation_id));
create function private.capture_social_policy() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 insert into public.social_meeting_policy(meeting_id,organisation_id,rule_id) select new.meeting_id,new.organisation_id,social_rule_id from public.group_settings where organisation_id=new.organisation_id and social_rule_id is not null on conflict do nothing;
 return new;
end $$;
revoke all on function private.capture_social_policy() from public,anon,authenticated;
create trigger capture_social_policy after insert on public.meeting_session for each row execute function private.capture_social_policy();
create trigger guard_social_post before insert on public.social_txn for each row execute function private.guard_meeting_post();

create function private.admin_social_rule(p_request uuid,p_device uuid,p_org uuid,p_amount text,p_roles text[],p_separate boolean,p_require_all boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; prior jsonb; rule_uuid uuid; begin
 payload:=jsonb_build_object('organisation',p_org,'device',p_device,'amount',p_amount,'roles',p_roles,'separate',p_separate,'require_all',p_require_all);
 prior:=private.admin_begin(p_request,'configure_social_fund',payload); if prior is not null then return prior; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not private.is_platform_admin() then raise exception 'Not permitted' using errcode='42501'; end if;
 if p_device is null or p_separate is null or p_require_all is null or p_roles is null or (p_amount is null and cardinality(p_roles)<>0) or (p_amount is not null and (p_amount !~ '^[1-9][0-9]{0,18}$' or p_amount::numeric>9223372036854775807 or cardinality(p_roles)=0 or not p_roles<@array['secretary','treasurer','chair']::text[] or array_position(p_roles,null) is not null or cardinality(p_roles)<>(select count(distinct x) from unnest(p_roles) x))) then raise exception 'Invalid social settings' using errcode='22023'; end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Invalid group' using errcode='22023'; end if;
 if p_amount is not null then
  insert into public.social_rule(organisation_id,contribution,approver_roles,separate_approver,require_all,entered_by) values(p_org,p_amount::bigint,p_roles,p_separate,p_require_all,private.current_person()) returning id into rule_uuid;
  insert into public.ledger_account(organisation_id,code) values(p_org,'social_fund') on conflict do nothing;
 end if;
 update public.group_settings set social_rule_id=rule_uuid where organisation_id=p_org;
 return private.admin_finish(p_request,'configure_social_fund',payload,jsonb_build_object('id',p_org),p_org,p_device,coalesce(rule_uuid,p_org));
end $$;
grant create on schema private to yapesa_administrator;
alter function private.admin_social_rule(uuid,uuid,uuid,text,text[],boolean,boolean) owner to yapesa_administrator;
revoke create on schema private from yapesa_administrator;
revoke all on function private.admin_social_rule(uuid,uuid,uuid,text,text[],boolean,boolean) from public,anon,authenticated;
grant execute on function private.admin_social_rule(uuid,uuid,uuid,text,text[],boolean,boolean) to authenticated;
create function public.admin_social_rule(p_request uuid,p_device uuid,p_org uuid,p_amount text,p_roles text[],p_separate boolean,p_require_all boolean) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_social_rule(p_request,p_device,p_org,p_amount,p_roles,p_separate,p_require_all); $$;
revoke all on function public.admin_social_rule(uuid,uuid,uuid,text,text[],boolean,boolean) from public,anon,authenticated;
grant execute on function public.admin_social_rule(uuid,uuid,uuid,text,text[],boolean,boolean) to authenticated;

create function private.social_balance(p_org uuid) returns numeric language sql stable security invoker set search_path='' as $$ select coalesce(sum(case when l.side='credit' then l.amount else -l.amount end),0) from public.journal_line l join public.ledger_account a on a.id=l.account_id where a.organisation_id=p_org and a.code='social_fund'; $$;
create function private.social_contributed(p_org uuid,p_meeting uuid,p_member uuid) returns numeric language sql stable security invoker set search_path='' as $$ select coalesce(sum(t.cash),0) from public.social_txn t left join public.social_txn original on original.id=t.reverses where t.organisation_id=p_org and t.meeting_id=p_meeting and t.member_id=p_member and (t.kind='contribution' or original.kind='contribution'); $$;
create function private.social_can_approve(p_org uuid,p_request uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select private.session_active(true) and exists(select 1 from public.social_request r join public.social_rule s on s.id=r.rule_id where r.id=p_request and r.organisation_id=p_org and private.has_role(p_org,s.approver_roles) and (not s.separate_approver or r.entered_by<>private.current_person()));
$$;
revoke all on function private.social_balance(uuid),private.social_contributed(uuid,uuid,uuid),private.social_can_approve(uuid,uuid) from public,anon,authenticated;
grant execute on function private.social_balance(uuid),private.social_contributed(uuid,uuid,uuid),private.social_can_approve(uuid,uuid) to authenticated,yapesa_social,yapesa_meetings;

create function private.social_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_meeting uuid,p_member uuid,p_amount text,p_reason text,p_target uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; prior public.sync_receipt; payload jsonb; result_data jsonb; meet public.meeting; rule public.social_rule; original public.social_txn; request_row public.social_request; cash bigint; record_uuid uuid:=gen_random_uuid(); journal_uuid uuid:=gen_random_uuid(); request_uuid uuid; balance numeric; expected numeric; post_kind text;
begin
 if p_action is null or p_action not in ('start','contribute','grant','reverse','approve','cancel') or not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 actor:=private.current_person();
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not private.is_officer(p_org) or (p_action<>'approve' and not private.can_record(p_org)) then raise exception 'Not permitted' using errcode='42501'; end if;
 if p_request is null or p_request::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or p_device is null or p_reason is null or length(p_reason)>240 then raise exception 'Invalid social command' using errcode='22023'; end if;
 payload:=jsonb_build_object('actor',actor,'action',p_action,'device',p_device,'meeting',p_meeting,'member',p_member,'amount',p_amount,'reason',p_reason,'target',p_target);
 select * into prior from public.sync_receipt where client_id=p_request;
 if found then if prior.organisation_id<>p_org or prior.request<>payload then raise exception 'Idempotency conflict' using errcode='23505'; end if; return prior.result; end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Inactive group' using errcode='22023'; end if;
 if p_action<>'approve' and (select writer_device_id from public.group_settings where organisation_id=p_org) is distinct from p_device then raise exception 'Writer device required' using errcode='42501'; end if;
 if not exists(select 1 from public.device where id=p_device and organisation_id=p_org) then insert into public.device(id,organisation_id,registered_by) values(p_device,p_org,actor); end if;
 if p_action in ('approve','cancel') then
  if p_target is null or p_meeting is not null or p_member is not null or p_amount is not null or p_reason<>'' then raise exception 'Invalid request action' using errcode='22023'; end if;
  select * into strict request_row from public.social_request where id=p_target and organisation_id=p_org;
  if p_action='approve' and not private.social_can_approve(p_org,request_row.id) then raise exception 'Configured group officer required' using errcode='42501'; end if;
  if exists(select 1 from public.social_resolution where request_id=request_row.id) then raise exception 'Request already resolved' using errcode='23505'; end if;
  select * into strict meet from public.meeting where id=request_row.meeting_id and organisation_id=p_org;
 else
  if p_meeting is null then raise exception 'Meeting required' using errcode='22023'; end if;
  select * into strict meet from public.meeting where id=p_meeting and organisation_id=p_org;
 end if;
 if meet.status<>'open' or not exists(select 1 from public.meeting_session where meeting_id=meet.id) or not exists(select 1 from public.cycle where id=meet.cycle_id and status='active') then raise exception 'Open meeting required' using errcode='22023'; end if;
 if exists(select 1 from public.meeting m where m.organisation_id=p_org and m.meeting_date>meet.meeting_date and (m.status='closed' or exists(select 1 from public.meeting_session s where s.meeting_id=m.id))) then raise exception 'Meeting history locked' using errcode='22023'; end if;
 if p_action not in ('approve','cancel') then
  if not exists(select 1 from public.social_meeting_policy where meeting_id=meet.id) then
   insert into public.social_meeting_policy(meeting_id,organisation_id,rule_id) select meet.id,p_org,social_rule_id from public.group_settings where organisation_id=p_org and social_rule_id is not null;
  end if;
 end if;
 select s.* into strict rule from public.social_rule s join public.social_meeting_policy p on p.rule_id=s.id where p.meeting_id=meet.id and p.organisation_id=p_org;
 if p_action='start' then
  if p_member is not null or p_amount is not null or p_target is not null or p_reason<>'' then raise exception 'Invalid start' using errcode='22023'; end if;
  record_uuid:=rule.id;
 elsif p_action='cancel' then
  insert into public.social_resolution(id,organisation_id,request_id,outcome,actor_id,device_id) values(record_uuid,p_org,request_row.id,'cancelled',actor,p_device);
 elsif p_action in ('grant','reverse') then
  if p_reason !~ '[^[:space:]]' then raise exception 'Reason required' using errcode='22023'; end if;
  if p_action='grant' then
   if p_member is null or p_amount is null or p_target is not null or p_amount !~ '^[1-9][0-9]{0,18}$' then raise exception 'Invalid grant' using errcode='22023'; end if;
   cash:=-p_amount::bigint;
   if not exists(select 1 from public.membership where organisation_id=p_org and person_id=p_member and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'Active member required' using errcode='22023'; end if;
  else
   if p_target is null or p_member is not null or p_amount is not null then raise exception 'Invalid reversal' using errcode='22023'; end if;
   select * into strict original from public.social_txn where id=p_target and organisation_id=p_org and meeting_id=meet.id and kind<>'reversal';
   if exists(select 1 from public.social_txn where reverses=original.id) or exists(select 1 from public.social_request r where r.target_id=original.id and not exists(select 1 from public.social_resolution where request_id=r.id)) then raise exception 'Reversal already exists' using errcode='23505'; end if;
   cash:=-original.cash;
  end if;
  insert into public.social_request(id,organisation_id,meeting_id,rule_id,member_id,kind,cash,target_id,reason,entered_by,device_id)
   values(record_uuid,p_org,meet.id,rule.id,coalesce(p_member,original.member_id),case when p_action='grant' then 'grant' else 'reversal' end,cash,p_target,p_reason,actor,p_device);
 else
  if p_action='contribute' then
   if p_member is null or p_amount is not null or p_target is not null then raise exception 'Invalid contribution' using errcode='22023'; end if;
   if not exists(select 1 from public.membership where organisation_id=p_org and person_id=p_member and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'Active member required' using errcode='22023'; end if;
   if private.social_contributed(p_org,meet.id,p_member)<>0 then raise exception 'Contribution already recorded' using errcode='23505'; end if;
   cash:=rule.contribution; post_kind:='contribution';
  else
   cash:=request_row.cash; post_kind:=request_row.kind; request_uuid:=request_row.id;
   if post_kind='reversal' then
    select * into strict original from public.social_txn where id=request_row.target_id and organisation_id=p_org and meeting_id=meet.id and kind<>'reversal';
    if exists(select 1 from public.social_txn where reverses=original.id) then raise exception 'Already reversed' using errcode='23505'; end if;
    if cash<>-original.cash then raise exception 'Reversal amount mismatch' using errcode='23514'; end if;
   elsif not exists(select 1 from public.membership where organisation_id=p_org and person_id=request_row.member_id and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'Active recipient required' using errcode='22023'; end if;
  end if;
  balance:=private.social_balance(p_org)+cash;
  expected:=(private.meeting_snapshot(p_org,meet.id)->>'expected_cash')::numeric+cash;
  if balance<0 or balance>9223372036854775807 or expected<0 or expected>9223372036854775807 then raise exception 'Insufficient or invalid social cash balance' using errcode='22023'; end if;
  insert into public.journal(id,organisation_id,currency,calc_version) select journal_uuid,p_org,currency,'groups-social-v1' from public.organisation where id=p_org;
  if post_kind='reversal' then
   insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select p_org,journal_uuid,account_id,case when side='debit' then 'credit' else 'debit' end,amount from public.journal_line where journal_id=original.journal_id;
  else
   insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select p_org,journal_uuid,id,case when (code='cash')=(cash>0) then 'debit' else 'credit' end,abs(cash) from public.ledger_account where organisation_id=p_org and code in ('cash','social_fund');
  end if;
  if (select count(*) from public.journal_line where journal_id=journal_uuid)<>2 then raise exception 'Social accounts incomplete' using errcode='23514'; end if;
  insert into public.social_txn(id,organisation_id,meeting_id,rule_id,member_id,kind,cash,reverses,request_id,journal_id,entered_by,device_id,note,calc_version)
   values(record_uuid,p_org,meet.id,rule.id,coalesce(p_member,request_row.member_id),post_kind,cash,case when post_kind='reversal' then original.id else null end,request_uuid,journal_uuid,actor,p_device,case when p_action='contribute' then p_reason else request_row.reason end,'groups-social-v1');
  if p_action='approve' then insert into public.social_resolution(organisation_id,request_id,outcome,actor_id,device_id) values(p_org,request_row.id,'approved',actor,p_device); end if;
 end if;
 result_data:=jsonb_build_object('id',record_uuid);
 insert into public.sync_receipt(client_id,organisation_id,request,result) values(p_request,p_org,payload,result_data);
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(p_org,actor,p_device,'social_'||p_action,record_uuid,payload||result_data);
 return result_data;
end $$;
grant create on schema private to yapesa_social;
alter function private.social_command(uuid,text,uuid,uuid,uuid,uuid,text,text,uuid) owner to yapesa_social;
revoke create on schema private from yapesa_social;
revoke all on function private.social_command(uuid,text,uuid,uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function private.social_command(uuid,text,uuid,uuid,uuid,uuid,text,text,uuid) to authenticated;
create function public.social_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_meeting uuid default null,p_member uuid default null,p_amount text default null,p_reason text default '',p_target uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.social_command(p_org,p_action,p_request,p_device,p_meeting,p_member,p_amount,p_reason,p_target); $$;
revoke all on function public.social_command(uuid,text,uuid,uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.social_command(uuid,text,uuid,uuid,uuid,uuid,text,text,uuid) to authenticated;

create or replace function private.meeting_snapshot(p_org uuid,p_meeting uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare opening numeric; cash_in numeric; cash_out numeric; expected numeric; roster jsonb; transactions jsonb; snapshot jsonb; begin
 select opening_cash into strict opening from public.meeting_session where organisation_id=p_org and meeting_id=p_meeting;
 select coalesce(sum(l.amount) filter(where l.side='debit'),0),coalesce(sum(l.amount) filter(where l.side='credit'),0) into cash_in,cash_out
 from public.journal_line l join public.ledger_account a on a.id=l.account_id join (select journal_id,meeting_id,organisation_id from public.group_txn union all select journal_id,meeting_id,organisation_id from public.social_txn) t on t.journal_id=l.journal_id where t.meeting_id=p_meeting and t.organisation_id=p_org and a.code='cash';
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
 return snapshot;
end $$;

-- Social requests and mandatory contributions are part of meeting-close validity.
create function private.guard_social_close() returns trigger language plpgsql security invoker set search_path='' as $$
declare rule public.social_rule; begin
 if exists(select 1 from public.social_request r where r.meeting_id=new.meeting_id and not exists(select 1 from public.social_resolution s where s.request_id=r.id)) then raise exception 'Resolve social requests before closing' using errcode='22023'; end if;
 select s.* into rule from public.social_meeting_policy p join public.social_rule s on s.id=p.rule_id where p.meeting_id=new.meeting_id;
 if found and rule.require_all and exists(select 1 from public.meeting_roster r where r.meeting_id=new.meeting_id and private.social_contributed(new.organisation_id,new.meeting_id,r.member_id)<>rule.contribution) then raise exception 'Complete required social contributions' using errcode='22023'; end if;
 return new;
end $$;
revoke all on function private.guard_social_close() from public,anon,authenticated;
create trigger guard_social_closing before insert on public.meeting_closing for each row execute function private.guard_social_close();
create trigger guard_social_approval before insert on public.meeting_approval for each row execute function private.guard_social_close();
create or replace function private.person_visible(p_person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.session_active(private.requires_mfa()) and
 (p_person=private.current_person()
 or exists(select 1 from public.membership m where m.person_id=p_person and private.is_officer(m.organisation_id) and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))
 or exists(select 1 from public.group_txn t where t.member_id=p_person and private.is_officer(t.organisation_id))
 or exists(select 1 from public.meeting_roster r where r.member_id=p_person and private.is_officer(r.organisation_id))
 or exists(select 1 from public.meeting_approval a where a.officer_id=p_person and private.is_officer(a.organisation_id))
 or exists(select 1 from public.social_request s where s.member_id=p_person and private.is_officer(s.organisation_id))
 or exists(select 1 from public.social_txn s where s.member_id=p_person and private.is_officer(s.organisation_id)));
$$;


create or replace function private.can_read_journal(p_journal uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
 exists(select 1 from public.group_txn t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id)))
 or exists(select 1 from public.social_txn t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id))));
$$;

create or replace function public.group_shareout_preview(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare org public.organisation; cyc public.cycle; members jsonb; allocations jsonb; fund numeric; recorded numeric; shares numeric;
begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select * into strict org from public.organisation where id=p_org and type='group' and status='active';
 select * into strict cyc from public.cycle where organisation_id=p_org and status='active';
 -- Fail closed if later posting types are introduced without extending this preview.
 if exists(select 1 from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=p_org and a.code not in ('cash','share_capital','social_fund')) then raise exception 'Unsupported fund composition' using errcode='22023'; end if;
 select coalesce(sum(case when l.side='debit' then l.amount else -l.amount end),0) into fund
 from public.journal_line l join public.ledger_account a on a.id=l.account_id join public.group_txn t on t.journal_id=l.journal_id join public.meeting m on m.id=t.meeting_id
 where l.organisation_id=p_org and m.cycle_id=cyc.id and a.code='cash';
 select coalesce(sum(t.amount),0),coalesce(sum(t.shares),0) into recorded,shares from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.organisation_id=p_org and m.cycle_id=cyc.id;
 if fund<>recorded or fund<0 or fund>9223372036854775807 or shares<0 then raise exception 'Fund cannot be previewed' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',member_id,'shares',net::text) order by member_id),'[]'::jsonb) into members
 from (select t.member_id,sum(t.shares) as net from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.organisation_id=p_org and m.cycle_id=cyc.id group by t.member_id) w;
 allocations:=private.shareout_allocation(fund::text,members);
 return jsonb_build_object('cycle_id',cyc.id,'currency',org.currency,'fund',fund::text,'total_shares',shares::text,'calc_version','groups-shareout-preview-v1','scope','recorded-shares-only',
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'shares',w->>'shares','amount',a->>'amount') order by p.display_name,p.id) from jsonb_array_elements(members) w join public.person p on p.id=(w->>'id')::uuid join jsonb_array_elements(allocations) a on a->>'id'=w->>'id'),'[]'::jsonb));
end $$;

create function public.social_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare officer boolean; begin
 if not private.can_read_org(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 officer:=private.is_officer(p_org);
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Inactive group' using errcode='22023'; end if;
 return jsonb_build_object('can_record',private.can_record(p_org),'can_configure',private.is_platform_admin(),'balance',case when officer then private.social_balance(p_org)::text else null end,
 'currency',(select currency from public.organisation where id=p_org),
 'rule',(select jsonb_build_object('id',r.id,'contribution',r.contribution::text,'roles',r.approver_roles,'separate',r.separate_approver,'require_all',r.require_all) from public.group_settings g join public.social_rule r on r.id=g.social_rule_id where g.organisation_id=p_org),
 'meetings',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'date',m.meeting_date,'status',m.status,'ready',exists(select 1 from public.meeting_session where meeting_id=m.id),'contribution',r.contribution::text,'started',p.meeting_id is not null) order by m.meeting_date desc,m.id) from public.meeting m left join public.social_meeting_policy p on p.meeting_id=m.id left join public.social_rule r on r.id=p.rule_id where m.organisation_id=p_org),'[]'::jsonb),
 'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'meeting_id',s.meeting_id,'date',m.meeting_date,'member_id',s.member_id,'name',p.display_name,'kind',s.kind,'cash',s.cash::text,'reverses',s.reverses,'journal_id',s.journal_id,'note',s.note,'recorded_at',s.recorded_at,'journal',
   (select jsonb_agg(jsonb_build_object('account',a.code,'side',l.side,'amount',l.amount::text) order by a.code) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.journal_id=s.journal_id)) order by s.recorded_at desc,s.id) from public.social_txn s join public.meeting m on m.id=s.meeting_id join public.person p on p.id=s.member_id where s.organisation_id=p_org),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'meeting_id',r.meeting_id,'date',m.meeting_date,'name',p.display_name,'kind',r.kind,'cash',r.cash::text,'reason',r.reason,'entered_by',r.entered_by,'outcome',s.outcome,'can_approve',m.status='open' and s.id is null and private.social_can_approve(p_org,r.id)) order by r.revision desc) from public.social_request r join public.meeting m on m.id=r.meeting_id join public.person p on p.id=r.member_id left join public.social_resolution s on s.request_id=r.id where r.organisation_id=p_org),'[]'::jsonb));
end $$;
revoke all on function public.social_workspace(uuid) from public,anon,authenticated;
grant execute on function public.social_workspace(uuid) to authenticated;

grant select on public.social_txn,public.ledger_account to yapesa_administrator;
create policy social_admin_txn_read on public.social_txn for select to yapesa_administrator using(private.is_platform_admin());
create or replace function private.admin_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_platform_admin() then raise exception 'Verified platform administrator required' using errcode='42501'; end if;
 return jsonb_build_object(
 'currencies',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'minor_digits',minor_digits) order by code),'[]') from public.currency_reference),
 'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name,'phone',phone,'has_login',auth_user_id is not null,'staff_ready',private.staff_ready(id)) order by display_name),'[]') from public.person),
 'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'country_code',o.country_code,'currency',o.currency,'time_zone',o.time_zone,'max_shares',gs.max_shares_per_meeting::text,
 'configuration_locked',exists(select 1 from public.group_txn t where t.organisation_id=o.id) or exists(select 1 from public.social_txn t where t.organisation_id=o.id),
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
 if exists(select 1 from public.group_txn where organisation_id=p_org) or exists(select 1 from public.social_txn where organisation_id=p_org) then raise exception 'Posted configuration is locked' using errcode='22023'; end if;
 update public.organisation set name=btrim(p_name) where id=p_org;
 update public.group_settings set max_shares_per_meeting=p_max::bigint where organisation_id=p_org;
 if exists(select 1 from public.cycle where organisation_id=p_org and status='active' and share_price<>p_price::bigint) then raise exception 'Cycle share price is fixed' using errcode='22023'; end if;
 update public.cycle set starts_on=p_starts,ends_on=p_ends where organisation_id=p_org and status='active';
 if not found then insert into public.cycle(organisation_id,starts_on,ends_on,share_price) values(p_org,p_starts,p_ends,p_price::bigint); end if;
 return private.admin_finish(p_request,'configure_group',payload,jsonb_build_object('id',p_org),p_org,p_device,p_org);
end $$;

