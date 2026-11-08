-- Reviews preserve every original calculation and journal. No money writes.
do $$begin if not exists(select 1 from pg_roles where rolname='yapesa_reviews') then create role yapesa_reviews nologin noinherit nobypassrls;end if;end $$;
grant yapesa_reviews to postgres;
create table public.group_review(
 id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisation(id),
 kind text not null check(kind in ('calculation','closed_record')),source_type text not null check(source_type in ('share_calculation','loan_calculation','meeting','journal','shareout')),source_id uuid not null,
 source jsonb not null,reason text not null check(length(reason) between 1 and 500 and reason ~ '[^[:space:]]'),
 entered_by uuid not null references public.person(id),device_id uuid not null,recorded_at timestamptz not null default now(),unique(organisation_id,source_type,source_id),unique(id,organisation_id),
 foreign key(device_id,organisation_id) references public.device(id,organisation_id),check((kind='calculation' and source_type in ('share_calculation','loan_calculation')) or (kind='closed_record' and source_type in ('meeting','journal','shareout')))
);
create table public.review_proposal(
 id uuid primary key default gen_random_uuid(),revision bigint generated always as identity unique,organisation_id uuid not null references public.organisation(id),review_id uuid not null,
 outcome text not null check(outcome in ('confirmed','correction_required')),reason text not null check(length(reason) between 1 and 500 and reason ~ '[^[:space:]]'),
 entered_by uuid not null references public.person(id),device_id uuid not null,recorded_at timestamptz not null default now(),unique(id,review_id,organisation_id),
 foreign key(review_id,organisation_id) references public.group_review(id,organisation_id),foreign key(device_id,organisation_id) references public.device(id,organisation_id)
);
create table public.review_approval(
 id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisation(id),review_id uuid not null,proposal_id uuid not null,
 officer_id uuid not null references public.person(id),device_id uuid not null,recorded_at timestamptz not null default now(),unique(proposal_id,officer_id),
 foreign key(proposal_id,review_id,organisation_id) references public.review_proposal(id,review_id,organisation_id),foreign key(device_id,organisation_id) references public.device(id,organisation_id)
);
create table public.review_resolution(
 id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisation(id),review_id uuid not null unique,proposal_id uuid not null unique,
 outcome text not null check(outcome in ('confirmed','correction_required')),entered_by uuid not null references public.person(id),recorded_at timestamptz not null default now(),
 foreign key(proposal_id,review_id,organisation_id) references public.review_proposal(id,review_id,organisation_id)
);
do $$declare tbl text;begin foreach tbl in array array['group_review','review_proposal','review_approval','review_resolution'] loop
 execute format('alter table public.%I enable row level security',tbl);execute format('revoke all on public.%I from public,anon,authenticated',tbl);
 execute format('grant select on public.%I to authenticated,yapesa_reviews',tbl);execute format('grant insert on public.%I to yapesa_reviews',tbl);
 execute format('create policy review_read on public.%I for select to authenticated,yapesa_reviews using(private.is_officer(organisation_id))',tbl);
 execute format('create policy review_insert on public.%I for insert to yapesa_reviews with check(private.is_officer(organisation_id) and private.officer_eligible(organisation_id,private.current_person()))',tbl);
 execute format('create trigger immutable_record before update or delete on public.%I for each row execute function private.immutable_record()',tbl);
 execute format('create index on public.%I(organisation_id)',tbl);
 end loop;end $$;
create index on public.review_proposal(review_id,revision desc);
create index on public.group_review(entered_by);create index on public.review_proposal(entered_by);create index on public.review_approval(officer_id);create index on public.review_resolution(entered_by);
grant usage,select on sequence public.review_proposal_revision_seq to yapesa_reviews;
grant usage on schema public,private,auth to yapesa_reviews;
grant execute on function private.is_platform_admin(),private.session_active(boolean),private.current_person(),private.has_role(uuid,text[]),private.requires_mfa(),private.can_read_org(uuid),private.is_officer(uuid),private.can_record(uuid),private.person_visible(uuid),private.can_read_journal(uuid),private.officer_eligible(uuid,uuid) to yapesa_reviews;
grant select on public.person,public.membership,public.organisation,public.device,public.group_txn,public.loan_calculation,public.meeting,public.meeting_closing,public.journal,public.journal_line,public.ledger_account,public.social_txn,public.fine_event,public.loan_event,public.shareout_plan,public.shareout_commit,public.shareout_receipt,public.shareout_finalization,public.sync_receipt to yapesa_reviews;
grant insert on public.device,public.sync_receipt,public.audit_log to yapesa_reviews;
do $$declare tbl text;begin
 foreach tbl in array array['person','membership'] loop execute format('create policy reviews_lookup on public.%I for select to yapesa_reviews using(private.session_active(true))',tbl);end loop;
 foreach tbl in array array['organisation','device','group_txn','loan_calculation','meeting','meeting_closing','journal','journal_line','ledger_account','social_txn','fine_event','loan_event','shareout_plan','shareout_commit','shareout_receipt','shareout_finalization','sync_receipt'] loop execute format('create policy reviews_read on public.%I for select to yapesa_reviews using(private.is_officer(%I))',tbl,case when tbl='organisation' then 'id' else 'organisation_id' end);end loop;
 foreach tbl in array array['device','sync_receipt','audit_log'] loop execute format('create policy reviews_insert on public.%I for insert to yapesa_reviews with check(private.is_officer(organisation_id) and private.officer_eligible(organisation_id,private.current_person()))',tbl);end loop;
end $$;
create function private.review_source(p_org uuid,p_type text,p_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare source jsonb;begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501';end if;
 if p_type='share_calculation' then select to_jsonb(t)||jsonb_build_object('amount',t.amount::text,'shares',t.shares::text) into source from public.group_txn t where t.id=p_id and t.organisation_id=p_org and t.calculation_mismatch;
 elsif p_type='loan_calculation' then select to_jsonb(t) into source from public.loan_calculation t where t.command_id=p_id and t.organisation_id=p_org and t.calculation_mismatch;
 elsif p_type='meeting' then select jsonb_build_object('meeting',to_jsonb(m),'closing',case when c.id is null then null else to_jsonb(c)||jsonb_build_object('revision',c.revision::text,'expected_cash',c.expected_cash::text,'counted_cash',c.counted_cash::text,'difference',c.difference::text) end) into source from public.meeting m left join public.meeting_closing c on c.id=m.closed_proposal_id where m.id=p_id and m.organisation_id=p_org and m.status='closed';
 elsif p_type='shareout' then select jsonb_build_object('plan',to_jsonb(p),'finalization',to_jsonb(f)) into source from public.shareout_plan p join public.shareout_finalization f on f.plan_id=p.id where p.id=p_id and p.organisation_id=p_org;
 elsif p_type='journal' then
  if exists(select 1 from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.journal_id=p_id and t.organisation_id=p_org and m.status='closed')
   or exists(select 1 from public.social_txn t join public.meeting m on m.id=t.meeting_id where t.journal_id=p_id and t.organisation_id=p_org and m.status='closed')
   or exists(select 1 from public.fine_event t join public.meeting m on m.id=t.meeting_id where t.journal_id=p_id and t.organisation_id=p_org and m.status='closed')
   or exists(select 1 from public.loan_event t join public.meeting m on m.id=t.meeting_id where t.journal_id=p_id and t.organisation_id=p_org and m.status='closed')
   or exists(select 1 from public.shareout_commit where organisation_id=p_org and journal_id=p_id)
   or exists(select 1 from public.shareout_receipt where organisation_id=p_org and journal_id=p_id) then
   select jsonb_build_object('journal',to_jsonb(j),'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('amount',l.amount::text) order by l.id) from public.journal_line l where l.journal_id=j.id),'[]'::jsonb)) into source from public.journal j where j.id=p_id and j.organisation_id=p_org;
  end if;
 end if;
 if source is null then raise exception 'Eligible review source required' using errcode='22023';end if;return source;
end $$;
revoke all on function private.review_source(uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.review_source(uuid,text,uuid) to authenticated,yapesa_reviews;
create function private.review_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_kind text,p_source_type text,p_source uuid,p_review uuid,p_proposal uuid,p_outcome text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;payload jsonb;prior public.sync_receipt;review public.group_review;proposal public.review_proposal;record_uuid uuid:=gen_random_uuid();result jsonb;source jsonb;begin
 if not private.is_officer(p_org) or not private.officer_eligible(p_org,private.current_person()) then raise exception 'Current group officer required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if not private.is_officer(p_org) or not private.officer_eligible(p_org,private.current_person()) then raise exception 'Authority changed' using errcode='42501';end if;actor:=private.current_person();
 if p_request is null or p_request::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or p_device is null or p_action is null or p_action not in ('open','propose','approve') or p_reason is null or length(p_reason)>500 or (p_action<>'approve' and p_reason !~ '[^[:space:]]') or (p_action='approve' and p_reason<>'') then raise exception 'Invalid review command' using errcode='22023';end if;
 if (p_action='open' and (p_kind is null or p_kind not in ('calculation','closed_record') or p_source_type is null or p_source is null or p_review is not null or p_proposal is not null or p_outcome is not null)) or
 (p_action='propose' and (p_review is null or p_outcome is null or p_outcome not in ('confirmed','correction_required') or p_kind is not null or p_source_type is not null or p_source is not null or p_proposal is not null)) or
 (p_action='approve' and (p_review is null or p_proposal is null or p_kind is not null or p_source_type is not null or p_source is not null or p_outcome is not null)) then raise exception 'Invalid review fields' using errcode='22023';end if;
 payload:=jsonb_build_object('feature','group_review','actor',actor,'action',p_action,'device',p_device,'kind',p_kind,'source_type',p_source_type,'source',p_source,'review',p_review,'proposal',p_proposal,'outcome',p_outcome,'reason',p_reason);
 select * into prior from public.sync_receipt where client_id=p_request;
 if found then if prior.organisation_id<>p_org or prior.request<>payload then raise exception 'Idempotency conflict' using errcode='23505';end if;return prior.result;end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') then raise exception 'Active group required' using errcode='22023';end if;
 if not exists(select 1 from public.device where id=p_device and organisation_id=p_org) then insert into public.device(id,organisation_id,registered_by) values(p_device,p_org,actor);end if;
 if p_action='open' then
  source:=private.review_source(p_org,p_source_type,p_source);
  insert into public.group_review(id,organisation_id,kind,source_type,source_id,source,reason,entered_by,device_id) values(record_uuid,p_org,p_kind,p_source_type,p_source,source,p_reason,actor,p_device);
 else
  select * into strict review from public.group_review where id=p_review and organisation_id=p_org;
  if exists(select 1 from public.review_resolution where review_id=review.id) then raise exception 'Review already decided' using errcode='22023';end if;
  if p_action='propose' then
   insert into public.review_proposal(id,organisation_id,review_id,outcome,reason,entered_by,device_id) values(record_uuid,p_org,review.id,p_outcome,p_reason,actor,p_device);
  else
   select * into strict proposal from public.review_proposal where id=p_proposal and review_id=review.id and organisation_id=p_org;
   if proposal.id is distinct from (select id from public.review_proposal where review_id=review.id order by revision desc limit 1) then raise exception 'Review proposal is stale' using errcode='22023';end if;
   insert into public.review_approval(id,organisation_id,review_id,proposal_id,officer_id,device_id) values(record_uuid,p_org,review.id,proposal.id,actor,p_device);
   if (select count(*) from public.review_approval a where a.proposal_id=proposal.id and private.officer_eligible(p_org,a.officer_id))>=2 then insert into public.review_resolution(organisation_id,review_id,proposal_id,outcome,entered_by) values(p_org,review.id,proposal.id,proposal.outcome,actor);end if;
  end if;
 end if;
 result:=jsonb_build_object('id',record_uuid);
 insert into public.sync_receipt(client_id,organisation_id,request,result) values(p_request,p_org,payload,result);
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(p_org,actor,p_device,'review_'||p_action,record_uuid,payload||result);
 return result;
end $$;
grant create on schema private to yapesa_reviews;
alter function private.review_command(uuid,text,uuid,uuid,text,text,uuid,uuid,uuid,text,text) owner to yapesa_reviews;
revoke create on schema private from yapesa_reviews;
revoke all on function private.review_command(uuid,text,uuid,uuid,text,text,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function private.review_command(uuid,text,uuid,uuid,text,text,uuid,uuid,uuid,text,text) to authenticated;
create function public.review_command(p_org uuid,p_action text,p_request uuid,p_device uuid,p_kind text default null,p_source_type text default null,p_source uuid default null,p_review uuid default null,p_proposal uuid default null,p_outcome text default null,p_reason text default '') returns jsonb language sql security invoker set search_path='' as $$select private.review_command(p_org,p_action,p_request,p_device,p_kind,p_source_type,p_source,p_review,p_proposal,p_outcome,p_reason);$$;
revoke all on function public.review_command(uuid,text,uuid,uuid,text,text,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_command(uuid,text,uuid,uuid,text,text,uuid,uuid,uuid,text,text) to authenticated;

create function public.review_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501';end if;
 return jsonb_build_object('actor_id',private.current_person(),'can_decide',private.officer_eligible(p_org,private.current_person()),
 'mismatches',coalesce((select jsonb_agg(jsonb_build_object('type',s.kind,'id',s.id,'member_id',s.member_id,'name',p.display_name,'recorded_at',s.recorded_at,'review_id',(select id from public.group_review r where r.organisation_id=p_org and r.source_type=s.kind and r.source_id=s.id)) order by s.recorded_at,s.id) from (
 select 'share_calculation' kind,t.id,t.member_id,t.recorded_at from public.group_txn t where t.organisation_id=p_org and t.calculation_mismatch union all select 'loan_calculation',l.command_id,l.member_id,l.recorded_at from public.loan_calculation l where l.organisation_id=p_org and l.calculation_mismatch) s join public.person p on p.id=s.member_id),'[]'::jsonb),
 'closed_sources',coalesce((select jsonb_agg(jsonb_build_object('type',s.kind,'id',s.id,'date',s.date) order by s.date desc,s.id) from (
 select 'meeting' kind,m.id,m.meeting_date::text date from public.meeting m where m.organisation_id=p_org and m.status='closed' union all select 'shareout',p.id,f.recorded_at::date::text from public.shareout_plan p join public.shareout_finalization f on f.plan_id=p.id where p.organisation_id=p_org) s),'[]'::jsonb),
 'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'source_type',r.source_type,'source_id',r.source_id,'source',r.source,'reason',r.reason,'entered_by',r.entered_by,'recorded_at',r.recorded_at,
 'proposal',case when p.id is null then null else jsonb_build_object('id',p.id,'outcome',p.outcome,'reason',p.reason,'entered_by',p.entered_by,'recorded_at',p.recorded_at,'approvals',coalesce((select jsonb_agg(jsonb_build_object('officer_id',a.officer_id,'eligible',private.officer_eligible(p_org,a.officer_id),'recorded_at',a.recorded_at) order by a.recorded_at,a.id) from public.review_approval a where a.proposal_id=p.id),'[]'::jsonb)) end,
 'resolution',case when x.id is null then null else jsonb_build_object('outcome',x.outcome,'recorded_at',x.recorded_at,'proposal_id',x.proposal_id) end) order by r.recorded_at desc,r.id) from public.group_review r left join lateral(select * from public.review_proposal p where p.review_id=r.id order by revision desc limit 1) p on true left join public.review_resolution x on x.review_id=r.id where r.organisation_id=p_org),'[]'::jsonb));
end $$;
revoke all on function public.review_workspace(uuid) from public,anon,authenticated;
grant execute on function public.review_workspace(uuid) to authenticated;
