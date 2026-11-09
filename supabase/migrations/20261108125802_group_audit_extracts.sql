-- Audit extracts are read-only and retain original recorded evidence as text.
do $$begin if not exists(select 1 from pg_roles where rolname='yapesa_audit') then create role yapesa_audit nologin noinherit nobypassrls;end if;end $$;
grant yapesa_audit to postgres;
grant usage on schema public,private to yapesa_audit;
grant execute on function private.is_officer(uuid),private.has_role(uuid,text[]),private.is_platform_admin(),private.current_person(),private.session_active(boolean),private.officer_organisations() to yapesa_audit;
create index audit_log_org_time on public.audit_log(organisation_id,occurred_at,id);
create index audit_log_org_record on public.audit_log(organisation_id,record_id);
create index audit_log_actor on public.audit_log(actor_id);
do $$declare tbl text;begin foreach tbl in array array['audit_log','group_txn','social_txn','fine_event','loan_event','shareout_commit','shareout_receipt','share_out','journal','journal_line','ledger_account'] loop
 execute format('grant select on public.%I to yapesa_audit',tbl);
 execute format('create policy scoped_audit_read on public.%I for select to yapesa_audit using(organisation_id in(select private.officer_organisations()) or (select private.is_platform_admin()))',tbl);
 end loop;end $$;
grant select on public.organisation,public.currency_reference,public.person to yapesa_audit;
create policy scoped_audit_org on public.organisation for select to yapesa_audit using(id in(select private.officer_organisations()) or (select private.is_platform_admin()));
create policy scoped_audit_currency on public.currency_reference for select to yapesa_audit using((select private.session_active(true)));
create policy scoped_audit_actor on public.person for select to yapesa_audit using(id=(select private.current_person()) or exists(select 1 from public.audit_log a where a.actor_id=person.id) or exists(select 1 from public.group_txn t where t.member_id=person.id) or exists(select 1 from public.social_txn t where t.member_id=person.id) or exists(select 1 from public.fine_event t where t.member_id=person.id) or exists(select 1 from public.loan_event t where t.member_id=person.id) or exists(select 1 from public.share_out t where t.member_id=person.id));

create function private.audit_sources(p_org uuid) returns table(id uuid,journal_id uuid,reverses uuid,refs uuid[],kind text,evidence text) language sql stable security invoker set search_path='' as $$
 select t.id,t.journal_id,t.reverses,array[t.id,t.journal_id,t.reverses,t.meeting_id],'share_transaction',jsonb_build_object('record',to_jsonb(t),'member_name',(select p.display_name from public.person p where p.id=t.member_id))::text from public.group_txn t where t.organisation_id=p_org
 union all select t.id,t.journal_id,t.reverses,array[t.id,t.journal_id,t.reverses,t.meeting_id,t.request_id],'social_transaction',jsonb_build_object('record',to_jsonb(t),'member_name',(select p.display_name from public.person p where p.id=t.member_id))::text from public.social_txn t where t.organisation_id=p_org
 union all select t.id,t.journal_id,t.reverses,array[t.id,t.journal_id,t.reverses,t.meeting_id,t.charge_id],'fine_event',jsonb_build_object('record',to_jsonb(t),'member_name',(select p.display_name from public.person p where p.id=t.member_id))::text from public.fine_event t where t.organisation_id=p_org
 union all select t.id,t.journal_id,t.reverses,array[t.id,t.journal_id,t.reverses,t.meeting_id,t.loan_id],'loan_event',jsonb_build_object('record',to_jsonb(t),'member_name',(select p.display_name from public.person p where p.id=t.member_id))::text from public.loan_event t where t.organisation_id=p_org
 union all select t.id,t.journal_id,null::uuid,array[t.id,t.journal_id,t.cycle_id,t.plan_id],'shareout_commit',to_jsonb(t)::text from public.shareout_commit t where t.organisation_id=p_org
 union all select t.id,t.journal_id,null::uuid,array[t.id,t.journal_id,t.allocation_id,s.plan_id],'shareout_receipt',jsonb_build_object('receipt',to_jsonb(t),'allocation',to_jsonb(s),'member_name',(select p.display_name from public.person p where p.id=s.member_id))::text from public.shareout_receipt t join public.share_out s on s.id=t.allocation_id where t.organisation_id=p_org;
$$;
revoke all on function private.audit_sources(uuid) from public,anon,authenticated;

create function private.group_audit_extract(p_org uuid,p_from date,p_to date,p_record uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org public.organisation;start_at timestamptz;end_at timestamptz;keys uuid[];event_ids uuid[];record_ids uuid[];journal_ids uuid[];events jsonb;journals jsonb;sources jsonb;source_count bigint;source_bytes numeric;n bigint;bytes numeric;line_count bigint;digits integer;actor_name text;begin
 if not private.is_officer(p_org) and not private.is_platform_admin() then raise exception 'Verified officer or administrator required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from then raise exception 'Valid inclusive audit dates required' using errcode='22023';end if;
 select * into strict org from public.organisation where id=p_org and type='group';
 start_at:=p_from::timestamp at time zone org.time_zone;end_at:=(p_to+1)::timestamp at time zone org.time_zone;
 if p_record is not null then
  with initial as(select * from private.audit_sources(p_org) s where p_record=any(s.refs)), related as(
   select * from private.audit_sources(p_org) s where s.id in(select reverses from initial) or s.reverses in(select id from initial)
  ) select coalesce(array_agg(distinct value) filter(where value is not null),'{}'::uuid[])||array[p_record] into keys from(select unnest(refs) value from initial union all select unnest(refs) from related) q;
 end if;
 -- Count before materializing evidence. No silent truncation or approximate amounts.
 select count(*),coalesce(sum(octet_length(a.after_value::text)),0) into n,bytes from public.audit_log a where a.organisation_id=p_org and a.occurred_at>=start_at and a.occurred_at<end_at and
 (p_record is null or a.record_id=any(keys) or exists(select 1 from jsonb_each_text(case when jsonb_typeof(a.after_value)='object' then a.after_value else '{}'::jsonb end) field where field.key in ('journal_id','transaction_id','reverses','meeting_id','loan_id','plan_id','allocation_id','request_id') and field.value=any(select x::text from unnest(keys) x)));
 if n>5000 or bytes>2000000 then raise exception 'Audit extract too large; narrow dates or record reference' using errcode='54000';end if;
 select coalesce(array_agg(a.id order by a.occurred_at,a.id),'{}'::uuid[]),coalesce(array_agg(distinct a.record_id),'{}'::uuid[]) into event_ids,record_ids from public.audit_log a where a.organisation_id=p_org and a.occurred_at>=start_at and a.occurred_at<end_at and
 (p_record is null or a.record_id=any(keys) or exists(select 1 from jsonb_each_text(case when jsonb_typeof(a.after_value)='object' then a.after_value else '{}'::jsonb end) field where field.key in ('journal_id','transaction_id','reverses','meeting_id','loan_id','plan_id','allocation_id','request_id') and field.value=any(select x::text from unnest(keys) x)));
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'record_id',a.record_id,'actor_id',a.actor_id,'actor_name',p.display_name,'device_id',a.device_id,'action',a.action,'occurred_at',a.occurred_at,'evidence',a.after_value::text) order by a.occurred_at,a.id),'[]'::jsonb) into events from public.audit_log a join public.person p on p.id=a.actor_id where a.id=any(event_ids);
 if jsonb_array_length(events)<>n then raise exception 'Incomplete audit evidence' using errcode='42501';end if;
 select count(*),coalesce(sum(octet_length(s.evidence)),0) into source_count,source_bytes from private.audit_sources(p_org) s where s.refs&&record_ids;
 if source_count>5000 or source_bytes+bytes>2000000 then raise exception 'Audit source evidence too large; narrow dates or record reference' using errcode='54000';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'evidence',s.evidence) order by s.kind,s.id),'[]'::jsonb) into sources from private.audit_sources(p_org) s where s.refs&&record_ids;
 select coalesce(array_agg(distinct s.journal_id) filter(where s.journal_id is not null),'{}'::uuid[]) into journal_ids from private.audit_sources(p_org) s where s.refs&&record_ids;
 select count(*) into line_count from public.journal_line where organisation_id=p_org and journal_id=any(journal_ids);
 if cardinality(journal_ids)>5000 or line_count>20000 then raise exception 'Audit journals too large; narrow dates or record reference' using errcode='54000';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'created_at',j.created_at,'currency',j.currency,'calc_version',j.calc_version,'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'account',a.code,'side',l.side,'amount',l.amount::text) order by case l.side when 'debit' then 0 else 1 end,l.id) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.journal_id=j.id),'[]'::jsonb)) order by j.created_at,j.id),'[]'::jsonb) into journals from public.journal j where j.organisation_id=p_org and j.id=any(journal_ids);
 if jsonb_array_length(journals)<>cardinality(journal_ids) then raise exception 'Incomplete journal evidence' using errcode='42501';end if;
 select minor_digits into strict digits from public.currency_reference where code=org.currency;
 select display_name into strict actor_name from public.person where id=private.current_person();
 return jsonb_build_object('group_id',org.id,'group_name',org.name,'currency',org.currency,'minor_digits',digits,'time_zone',org.time_zone,'from_date',p_from,'to_date',p_to,'record_reference',p_record,'exported_by',private.current_person(),'exported_by_name',actor_name,'event_count',n::text,'source_count',source_count::text,'line_count',line_count::text,'events',events,'sources',sources,'journals',journals);
end $$;
grant create on schema private to yapesa_audit;
alter function private.audit_sources(uuid) owner to yapesa_audit;
alter function private.group_audit_extract(uuid,date,date,uuid) owner to yapesa_audit;
revoke create on schema private from yapesa_audit;
revoke all on function private.group_audit_extract(uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function private.group_audit_extract(uuid,date,date,uuid) to authenticated;
create function public.group_audit_extract(p_org uuid,p_from date,p_to date,p_record uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.group_audit_extract(p_org,p_from,p_to,p_record);$$;
revoke all on function public.group_audit_extract(uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function public.group_audit_extract(uuid,date,date,uuid) to authenticated;
