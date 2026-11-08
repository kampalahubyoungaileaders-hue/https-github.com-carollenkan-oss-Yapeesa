-- Final distribution records cash handovers; it does not transfer money.
do $$ begin if not exists(select 1 from pg_roles where rolname='yapesa_shareout') then create role yapesa_shareout nologin noinherit nobypassrls; end if; end $$;
grant yapesa_shareout to postgres;
alter table public.ledger_account drop constraint ledger_account_code_check;
alter table public.ledger_account add constraint ledger_account_code_check check(code in ('cash','share_capital','social_fund','fines_income','loans_receivable','interest_income','shareout_payable'));
create table public.shareout_plan(
 id uuid primary key default gen_random_uuid(), revision bigint generated always as identity unique,
 organisation_id uuid not null references public.organisation(id), cycle_id uuid not null, snapshot jsonb not null,
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'), entered_by uuid not null references public.person(id), device_id uuid not null,
 calc_version text not null check(calc_version='groups-final-shareout-v1'), recorded_at timestamptz not null default now(),
 unique(id,organisation_id), unique(id,cycle_id,organisation_id), foreign key(cycle_id,organisation_id) references public.cycle(id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id)
);
create table public.shareout_approval(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), plan_id uuid not null,
 officer_id uuid not null references public.person(id), device_id uuid not null, recorded_at timestamptz not null default now(), unique(plan_id,officer_id),
 foreign key(plan_id,organisation_id) references public.shareout_plan(id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id)
);
create table public.shareout_commit(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), cycle_id uuid not null unique, plan_id uuid not null unique,
 journal_id uuid unique, recorded_at timestamptz not null default now(), unique(plan_id,organisation_id),
 foreign key(plan_id,cycle_id,organisation_id) references public.shareout_plan(id,cycle_id,organisation_id), foreign key(journal_id,organisation_id) references public.journal(id,organisation_id)
);
create table public.share_out(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), plan_id uuid not null,
 member_id uuid not null references public.person(id), shares bigint not null check(shares>=0), amount bigint not null check(amount>=0),
 calc_version text not null check(calc_version='groups-final-shareout-v1'), unique(plan_id,member_id), unique(id,organisation_id),
 foreign key(plan_id,organisation_id) references public.shareout_commit(plan_id,organisation_id)
);
create table public.shareout_receipt(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), allocation_id uuid not null unique,
 amount bigint not null check(amount>0), journal_id uuid not null unique, entered_by uuid not null references public.person(id), device_id uuid not null,
 reason text not null check(length(reason) between 1 and 240 and reason ~ '[^[:space:]]'), recorded_at timestamptz not null default now(),
 foreign key(allocation_id,organisation_id) references public.share_out(id,organisation_id), foreign key(journal_id,organisation_id) references public.journal(id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id)
);
create table public.shareout_finalization(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), plan_id uuid not null unique,
 entered_by uuid not null references public.person(id), device_id uuid not null, recorded_at timestamptz not null default now(),
 foreign key(plan_id,organisation_id) references public.shareout_commit(plan_id,organisation_id), foreign key(device_id,organisation_id) references public.device(id,organisation_id)
);
do $$ declare tbl text; begin
 foreach tbl in array array['shareout_plan','shareout_approval','shareout_commit','share_out','shareout_receipt','shareout_finalization'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated',tbl);
  execute format('grant select on public.%I to authenticated,yapesa_shareout',tbl);
  execute format('grant insert on public.%I to yapesa_shareout',tbl);
  execute format('create policy officer_read on public.%I for select to authenticated,yapesa_shareout using(private.is_officer(organisation_id))',tbl);
  execute format('create policy shareout_insert on public.%I for insert to yapesa_shareout with check(private.is_officer(organisation_id))',tbl);
  execute format('create trigger immutable_record before update or delete on public.%I for each row execute function private.immutable_record()',tbl);
  execute format('create index on public.%I(organisation_id)',tbl);
 end loop;
end $$;
create policy member_allocation_read on public.share_out for select to authenticated using(private.can_read_org(organisation_id) and member_id=private.current_person());
create policy member_receipt_read on public.shareout_receipt for select to authenticated using(exists(select 1 from public.share_out s where s.id=allocation_id and s.member_id=private.current_person() and private.can_read_org(s.organisation_id)));
create index on public.shareout_plan(cycle_id,revision desc);
create index on public.shareout_approval(officer_id);
create index on public.share_out(member_id);
grant usage,select on sequence public.shareout_plan_revision_seq to yapesa_shareout;
grant usage on schema public,private,auth,extensions to yapesa_shareout;
grant execute on function private.is_platform_admin(),private.session_active(boolean),private.current_person(),private.has_role(uuid,text[]),private.requires_mfa(),private.can_read_org(uuid),private.is_officer(uuid),private.can_record(uuid),private.person_visible(uuid),private.can_read_journal(uuid),private.officer_eligible(uuid,uuid),private.shareout_allocation(text,jsonb),public.group_shareout_preview(uuid) to yapesa_shareout;
grant select on public.person,public.membership,public.organisation,public.cycle,public.group_settings,public.meeting,public.meeting_session,public.meeting_closing,public.meeting_approval,public.device,public.group_txn,public.journal,public.journal_line,public.ledger_account,public.sync_receipt,public.fine_charge,public.fine_event,public.social_txn,public.social_request,public.social_resolution,public.group_loan,public.loan_event,public.loan_request,public.loan_cancellation to yapesa_shareout;
grant insert on public.device,public.journal,public.journal_line,public.ledger_account,public.sync_receipt,public.audit_log to yapesa_shareout;
grant update(status) on public.cycle to yapesa_shareout;
do $$ declare tbl text; begin
 foreach tbl in array array['person','membership'] loop execute format('create policy shareout_lookup on public.%I for select to yapesa_shareout using(private.session_active(true))',tbl); end loop;
 foreach tbl in array array['organisation','cycle','group_settings','meeting','meeting_session','meeting_closing','meeting_approval','device','group_txn','journal','journal_line','ledger_account','sync_receipt','fine_charge','fine_event','social_txn','social_request','social_resolution','group_loan','loan_event','loan_request','loan_cancellation'] loop
  execute format('create policy shareout_read on public.%I for select to yapesa_shareout using(private.is_officer(%I))',tbl,case when tbl='organisation' then 'id' else 'organisation_id' end);
 end loop;
 foreach tbl in array array['device','journal','journal_line','ledger_account','sync_receipt','audit_log'] loop execute format('create policy shareout_insert on public.%I for insert to yapesa_shareout with check(private.is_officer(organisation_id))',tbl); end loop;
end $$;
create policy shareout_cycle_update on public.cycle for update to yapesa_shareout using(private.can_record(organisation_id)) with check(private.can_record(organisation_id));

-- Readiness is also recomputed under the organisation lock at preparation and
-- each approval. The snapshot is immutable and includes source balances/counts.
create function private.shareout_state(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare cyc public.cycle; last_meeting public.meeting; closing public.meeting_closing; preview jsonb; blockers jsonb:='[]'; cash numeric; social numeric; capital numeric; fines numeric; interest numeric;
begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select * into cyc from public.cycle where organisation_id=p_org and status='active';
 if not found then return jsonb_build_object('snapshot',null,'blockers',jsonb_build_array('No active cycle')); end if;
 if exists(select 1 from public.shareout_commit where cycle_id=cyc.id) then return jsonb_build_object('snapshot',null,'blockers',jsonb_build_array('Payouts already approved; use the saved allocation')); end if;
 preview:=public.group_shareout_preview(p_org);
 if exists(select 1 from public.meeting where organisation_id=p_org and status<>'closed') then blockers:=blockers||jsonb_build_array('Close every open meeting'); end if;
 if exists(select 1 from public.meeting where organisation_id=p_org and status='closed' and closed_proposal_id is null) then blockers:=blockers||jsonb_build_array('An older meeting has no verified closing count'); end if;
 if exists(select 1 from public.loan_request r where r.organisation_id=p_org and not exists(select 1 from public.group_loan l where l.request_id=r.id) and not exists(select 1 from public.loan_cancellation x where x.request_id=r.id)) then blockers:=blockers||jsonb_build_array('Resolve every pending loan request'); end if;
 if exists(select 1 from public.social_request r where r.organisation_id=p_org and not exists(select 1 from public.social_resolution x where x.request_id=r.id)) then blockers:=blockers||jsonb_build_array('Resolve every pending Social request'); end if;
 -- A principal-first payment can settle principal while leaving interest due.
 if exists(select 1 from public.group_loan l where l.organisation_id=p_org and not exists(select 1 from public.loan_event d join public.loan_event r on r.reverses=d.id where d.loan_id=l.id and d.kind='disbursement') and
 ((select -coalesce(sum(e.principal),0) from public.loan_event e where e.loan_id=l.id)<>0 or
 (select coalesce(sum((s->>'interest')::numeric),0) from jsonb_array_elements(l.schedule) s)<>(select coalesce(sum(e.interest),0) from public.loan_event e where e.loan_id=l.id))) then blockers:=blockers||jsonb_build_array('Settle all loan principal and agreed interest'); end if;
 if exists(select 1 from public.fine_charge c where c.organisation_id=p_org and c.amount::numeric<>(select coalesce(sum(e.cash::numeric+e.waived),0) from public.fine_event e where e.charge_id=c.id)) then blockers:=blockers||jsonb_build_array('Collect or explicitly waive all unpaid fines'); end if;
 select * into last_meeting from public.meeting where organisation_id=p_org and cycle_id=cyc.id order by meeting_date desc,id desc limit 1;
 select * into closing from public.meeting_closing where id=last_meeting.closed_proposal_id;
 if closing.id is null then blockers:=blockers||jsonb_build_array('A verified final meeting cash count is required'); end if;
 select coalesce(sum(case when a.code='cash' then case when l.side='debit' then l.amount else -l.amount end else 0 end),0),
 coalesce(sum(case when a.code='social_fund' then case when l.side='credit' then l.amount else -l.amount end else 0 end),0),
 coalesce(sum(case when a.code='share_capital' then case when l.side='credit' then l.amount else -l.amount end else 0 end),0),
 coalesce(sum(case when a.code='fines_income' then case when l.side='credit' then l.amount else -l.amount end else 0 end),0),
 coalesce(sum(case when a.code='interest_income' then case when l.side='credit' then l.amount else -l.amount end else 0 end),0)
 into cash,social,capital,fines,interest from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=p_org;
 if cash<0 or social<0 or capital<0 or fines<0 or interest<0 or cash>9223372036854775807 or cash-social<>(preview->>'fund')::numeric or capital+fines+interest<>(preview->>'fund')::numeric or closing.counted_cash::numeric is distinct from cash then blockers:=blockers||jsonb_build_array('Counted cash and the recorded fund must reconcile; Social money is reserved'); end if;
 return jsonb_build_object('blockers',blockers,'snapshot',jsonb_build_object('preview',preview,'cash',cash::text,'social',social::text,'capital',capital::text,'fines',fines::text,'interest',interest::text,'meeting_id',last_meeting.id,'closing_id',closing.id,'counted',closing.counted_cash::text));
end $$;
revoke all on function private.shareout_state(uuid) from public,anon,authenticated;
grant execute on function private.shareout_state(uuid) to authenticated,yapesa_shareout;

create function private.shareout_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_plan uuid,p_allocation uuid,p_reason text,p_confirm boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; prior public.sync_receipt; payload jsonb; result_data jsonb; state jsonb; plan public.shareout_plan; allocation public.share_out; committed public.shareout_commit; record_id uuid:=gen_random_uuid(); journal_id uuid; fund bigint; cash numeric; social numeric; payable numeric; account_name text; value bigint;
begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not private.is_officer(p_org) or p_action is null or p_action not in ('prepare','approve','pay','finish') or (p_action<>'approve' and not private.can_record(p_org)) then raise exception 'Not permitted' using errcode='42501'; end if;
 actor:=private.current_person();
 if p_action='approve' and not private.officer_eligible(p_org,actor) then raise exception 'Current group officer role required' using errcode='42501'; end if;
 if p_request is null or p_request::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or p_device is null or p_confirm is distinct from true or p_reason is null or length(p_reason)>240 or
 (p_action='prepare' and (p_plan is not null or p_allocation is not null or p_reason<>'')) or
 (p_action in ('approve','finish') and (p_plan is null or p_allocation is not null or p_reason<>'')) or
 (p_action='pay' and (p_plan is null or p_allocation is null or p_reason !~ '[^[:space:]]')) then raise exception 'Invalid share-out command' using errcode='22023'; end if;
 payload:=jsonb_build_object('actor',actor,'action',p_action,'device',p_device,'plan',p_plan,'allocation',p_allocation,'reason',p_reason,'confirmed',p_confirm);
 select * into prior from public.sync_receipt where client_id=p_request;
 if found then if prior.organisation_id<>p_org or prior.request<>payload then raise exception 'Idempotency conflict' using errcode='23505'; end if; return prior.result; end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Inactive group' using errcode='22023'; end if;
 if p_action<>'approve' and (select writer_device_id from public.group_settings where organisation_id=p_org) is distinct from p_device then raise exception 'Writer device required' using errcode='42501'; end if;
 if not exists(select 1 from public.device where id=p_device and organisation_id=p_org) then insert into public.device(id,organisation_id,registered_by) values(p_device,p_org,actor); end if;
 if p_action in ('prepare','approve') then
  state:=private.shareout_state(p_org);
  if jsonb_array_length(state->'blockers')<>0 then raise exception 'Share-out prerequisites are not satisfied' using errcode='22023'; end if;
  if p_action='prepare' then
   insert into public.shareout_plan(id,organisation_id,cycle_id,snapshot,snapshot_hash,entered_by,device_id,calc_version) values(record_id,p_org,(state#>>'{snapshot,preview,cycle_id}')::uuid,state->'snapshot',encode(extensions.digest((state->'snapshot')::text,'sha256'),'hex'),actor,p_device,'groups-final-shareout-v1');
  else
   select * into strict plan from public.shareout_plan where id=p_plan and organisation_id=p_org;
   if plan.id is distinct from (select id from public.shareout_plan where cycle_id=plan.cycle_id order by revision desc limit 1) or plan.snapshot is distinct from state->'snapshot' then raise exception 'Share-out proposal is stale' using errcode='22023'; end if;
   insert into public.shareout_approval(id,organisation_id,plan_id,officer_id,device_id) values(record_id,p_org,plan.id,actor,p_device);
   if (select count(*) from public.shareout_approval a where a.plan_id=plan.id and private.officer_eligible(p_org,a.officer_id))>=2 then
    fund:=(plan.snapshot#>>'{preview,fund}')::bigint;
    if fund>0 then
     insert into public.ledger_account(organisation_id,code) values(p_org,'shareout_payable') on conflict do nothing;
     journal_id:=gen_random_uuid();
     insert into public.journal(id,organisation_id,currency,calc_version) values(journal_id,p_org,plan.snapshot#>>'{preview,currency}','groups-final-shareout-v1');
     foreach account_name in array array['capital','fines','interest'] loop
      value:=(plan.snapshot->>account_name)::bigint;
      if value>0 then insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select p_org,journal_id,id,'debit',value from public.ledger_account where organisation_id=p_org and code=case account_name when 'capital' then 'share_capital' when 'fines' then 'fines_income' else 'interest_income' end; end if;
     end loop;
     insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select p_org,journal_id,id,'credit',fund from public.ledger_account where organisation_id=p_org and code='shareout_payable';
    end if;
    insert into public.shareout_commit(organisation_id,cycle_id,plan_id,journal_id) values(p_org,plan.cycle_id,plan.id,journal_id);
    insert into public.share_out(organisation_id,plan_id,member_id,shares,amount,calc_version) select p_org,plan.id,(m->>'id')::uuid,(m->>'shares')::bigint,(m->>'amount')::bigint,'groups-final-shareout-v1' from jsonb_array_elements(plan.snapshot#>'{preview,members}') m;
   end if;
  end if;
 else
  select * into strict committed from public.shareout_commit where plan_id=p_plan and organisation_id=p_org;
  select * into strict plan from public.shareout_plan where id=committed.plan_id;
  if exists(select 1 from public.shareout_finalization where plan_id=plan.id) or not exists(select 1 from public.cycle where id=plan.cycle_id and status='active') then raise exception 'Cycle already finalized' using errcode='22023'; end if;
  select coalesce(sum(case when a.code='cash' then case when l.side='debit' then l.amount else -l.amount end else 0 end),0),coalesce(sum(case when a.code='social_fund' then case when l.side='credit' then l.amount else -l.amount end else 0 end),0),coalesce(sum(case when a.code='shareout_payable' then case when l.side='credit' then l.amount else -l.amount end else 0 end),0) into cash,social,payable from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=p_org;
  if social<>(plan.snapshot->>'social')::numeric or cash-social<>payable or payable<>(select coalesce(sum(s.amount),0) from public.share_out s where s.plan_id=plan.id and not exists(select 1 from public.shareout_receipt r where r.allocation_id=s.id)) then raise exception 'Share-out cash or payable mismatch' using errcode='23514'; end if;
  if p_action='pay' then
   select * into strict allocation from public.share_out where id=p_allocation and plan_id=plan.id and organisation_id=p_org and amount>0;
   if exists(select 1 from public.shareout_receipt where allocation_id=allocation.id) or cash-allocation.amount<social then raise exception 'Payout already recorded or cash unavailable' using errcode='22023'; end if;
   journal_id:=gen_random_uuid();
   insert into public.journal(id,organisation_id,currency,calc_version) values(journal_id,p_org,plan.snapshot#>>'{preview,currency}','groups-final-shareout-v1');
   insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select p_org,journal_id,id,case code when 'cash' then 'credit' else 'debit' end,allocation.amount from public.ledger_account where organisation_id=p_org and code in ('cash','shareout_payable');
   insert into public.shareout_receipt(id,organisation_id,allocation_id,amount,journal_id,entered_by,device_id,reason) values(record_id,p_org,allocation.id,allocation.amount,journal_id,actor,p_device,p_reason);
  else
   if payable<>0 or cash<>social then raise exception 'Every payout must be recorded first' using errcode='22023'; end if;
   insert into public.shareout_finalization(id,organisation_id,plan_id,entered_by,device_id) values(record_id,p_org,plan.id,actor,p_device);
   update public.cycle set status='closed' where id=plan.cycle_id and organisation_id=p_org;
  end if;
 end if;
 result_data:=jsonb_build_object('id',record_id);
 insert into public.sync_receipt(client_id,organisation_id,request,result) values(p_request,p_org,payload,result_data);
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(p_org,actor,p_device,'shareout_'||p_action,record_id,payload||result_data);
 return result_data;
end $$;
grant create on schema private to yapesa_shareout;
alter function private.shareout_command(uuid,text,uuid,uuid,uuid,uuid,text,boolean) owner to yapesa_shareout;
revoke create on schema private from yapesa_shareout;
revoke all on function private.shareout_command(uuid,text,uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function private.shareout_command(uuid,text,uuid,uuid,uuid,uuid,text,boolean) to authenticated;
create function public.shareout_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_plan uuid default null,p_allocation uuid default null,p_reason text default '',p_confirm boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select private.shareout_command(p_org,p_action,p_request,p_device,p_plan,p_allocation,p_reason,p_confirm); $$;
revoke all on function public.shareout_command(uuid,text,uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.shareout_command(uuid,text,uuid,uuid,uuid,uuid,text,boolean) to authenticated;

-- The gate also covers existing posting RPCs and direct trusted executor paths.
create function private.guard_final_shareout() returns trigger language plpgsql security invoker set search_path='' as $$
declare target_cycle uuid; begin
 perform pg_advisory_xact_lock(hashtextextended(new.organisation_id::text,0));
 if tg_table_name='meeting' then target_cycle:=new.cycle_id;
 elsif tg_table_name='social_resolution' then select m.cycle_id into strict target_cycle from public.social_request r join public.meeting m on m.id=r.meeting_id where r.id=new.request_id and r.organisation_id=new.organisation_id;
 else select m.cycle_id into strict target_cycle from public.meeting m where m.id=new.meeting_id and m.organisation_id=new.organisation_id; end if;
 if exists(select 1 from public.shareout_commit c where c.cycle_id=target_cycle) then raise exception 'Cycle is locked for final share-out' using errcode='22023'; end if;
 return new;
end $$;
grant select on public.shareout_commit to yapesa_poster,yapesa_meetings,yapesa_social,yapesa_fines,yapesa_loans;
create policy executor_lock_read on public.shareout_commit for select to yapesa_poster,yapesa_meetings,yapesa_social,yapesa_fines,yapesa_loans using(private.is_officer(organisation_id));
revoke all on function private.guard_final_shareout() from public,anon,authenticated;
do $$ declare tbl text; begin foreach tbl in array array['meeting','attendance','group_txn','social_request','social_txn','social_resolution','fine_charge','fine_event','loan_request','loan_approval','loan_cancellation','group_loan','loan_event'] loop execute format('create trigger guard_final_shareout before insert on public.%I for each row execute function private.guard_final_shareout()',tbl); end loop; end $$;

create function public.shareout_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare state jsonb; plan public.shareout_plan; committed public.shareout_commit; begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 state:=private.shareout_state(p_org);
 select * into plan from public.shareout_plan where organisation_id=p_org and cycle_id=coalesce((select id from public.cycle where organisation_id=p_org and status='active'),(select cycle_id from public.shareout_plan where organisation_id=p_org order by revision desc limit 1)) order by revision desc limit 1;
 select * into committed from public.shareout_commit where plan_id=plan.id;
 return jsonb_build_object('currency',(select currency from public.organisation where id=p_org),'can_record',private.can_record(p_org),'actor_id',private.current_person(),'can_approve',private.officer_eligible(p_org,private.current_person()),'readiness',state,
 'plan',case when plan.id is null then null else jsonb_build_object('id',plan.id,'cycle_id',plan.cycle_id,'snapshot',plan.snapshot,'snapshot_hash',plan.snapshot_hash,'calc_version',plan.calc_version,'entered_by',plan.entered_by,'recorded_at',plan.recorded_at,
 'current',committed.id is not null or (state->'snapshot'=plan.snapshot and jsonb_array_length(state->'blockers')=0),
 'committed',committed.id is not null,'finalized',exists(select 1 from public.shareout_finalization where plan_id=plan.id),
 'approvals',coalesce((select jsonb_agg(jsonb_build_object('officer_id',a.officer_id,'eligible',private.officer_eligible(p_org,a.officer_id),'recorded_at',a.recorded_at) order by a.recorded_at,a.id) from public.shareout_approval a where a.plan_id=plan.id),'[]'::jsonb),
 'commit_journal',coalesce((select jsonb_agg(jsonb_build_object('account',a.code,'side',l.side,'amount',l.amount::text) order by a.code) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.journal_id=committed.journal_id),'[]'::jsonb),
 'allocations',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'member_id',s.member_id,'name',p.display_name,'shares',s.shares::text,'amount',s.amount::text,'receipt',case when r.id is null then null else jsonb_build_object('id',r.id,'amount',r.amount::text,'reason',r.reason,'recorded_at',r.recorded_at,'entered_by',r.entered_by,'journal_id',r.journal_id,'journal',coalesce((select jsonb_agg(jsonb_build_object('account',a.code,'side',l.side,'amount',l.amount::text) order by a.code) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.journal_id=r.journal_id),'[]'::jsonb)) end) order by p.display_name,p.id) from public.share_out s join public.person p on p.id=s.member_id left join public.shareout_receipt r on r.allocation_id=s.id where s.plan_id=plan.id),'[]'::jsonb)) end);
end $$;
revoke all on function public.shareout_workspace(uuid) from public,anon,authenticated;
grant execute on function public.shareout_workspace(uuid) to authenticated;

create or replace function private.can_read_journal(p_journal uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
 exists(select 1 from public.group_txn t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id)))
 or exists(select 1 from public.social_txn t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id)))
 or exists(select 1 from public.fine_event t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id)))
 or exists(select 1 from public.shareout_commit c where c.journal_id=p_journal and private.is_officer(c.organisation_id))
 or exists(select 1 from public.shareout_receipt r join public.share_out s on s.id=r.allocation_id where r.journal_id=p_journal and private.can_read_org(r.organisation_id) and (s.member_id=private.current_person() or private.is_officer(r.organisation_id)))
 or exists(select 1 from public.loan_event t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id))));
$$;

create or replace function public.group_shareout_preview(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare org public.organisation; cyc public.cycle; members jsonb; allocations jsonb; fund numeric; recorded numeric; shares numeric; fine_income numeric; loan_income numeric; outstanding numeric;
begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select * into strict org from public.organisation where id=p_org and type='group' and status='active';
 select * into strict cyc from public.cycle where organisation_id=p_org and status='active';
 -- Fail closed if later posting types are introduced without extending this preview.
 if exists(select 1 from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=p_org and a.code not in ('cash','share_capital','social_fund','fines_income','loans_receivable','interest_income','shareout_payable')) then raise exception 'Unsupported fund composition' using errcode='22023'; end if;
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

create or replace function public.group_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb; begin
 if not private.can_read_org(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select jsonb_build_object(
 'group',jsonb_build_object('id',o.id,'name',o.name,'currency',o.currency,'time_zone',o.time_zone,'country_code',o.country_code,'minor_digits',cr.minor_digits,'max_shares',gs.max_shares_per_meeting::text,'can_record',private.can_record(o.id) and not exists(select 1 from public.shareout_commit sc join public.cycle c on c.id=sc.cycle_id where sc.organisation_id=o.id and c.status='active'),'can_preview_shareout',private.is_officer(o.id)),
 'cycle',(select jsonb_build_object('id',c.id,'starts_on',c.starts_on,'ends_on',c.ends_on,'share_price',c.share_price::text) from public.cycle c where c.organisation_id=o.id and c.status='active'),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'active',exists(select 1 from public.membership m where m.person_id=p.id and m.organisation_id=o.id and m.role='member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))) order by p.display_name) from public.person p where exists(select 1 from public.membership m where m.person_id=p.id and m.organisation_id=o.id and m.role='member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())) or exists(select 1 from public.group_txn t where t.member_id=p.id and t.organisation_id=o.id)),'[]'::jsonb),
 'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'member_id',t.member_id,'meeting_date',m.meeting_date,'recorded_at',t.recorded_at,'shares',t.shares::text,'amount',t.amount::text,'currency',t.currency,'journal_id',t.journal_id,'calculation_mismatch',t.calculation_mismatch,'note',t.note,'reverses',t.reverses) order by t.recorded_at desc) from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.organisation_id=o.id),'[]'::jsonb),
 'meeting_count',(select count(*)::text from public.meeting where organisation_id=o.id),
 'journal_lines',coalesce((select jsonb_agg(jsonb_build_object('journal_id',l.journal_id,'account',a.code,'side',l.side,'amount',l.amount::text)) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=o.id),'[]'::jsonb)) into data
 from public.organisation o join public.currency_reference cr on cr.code=o.currency join public.group_settings gs on gs.organisation_id=o.id where o.id=p_org and o.type='group' and o.status='active';
 return data;
end $$;
