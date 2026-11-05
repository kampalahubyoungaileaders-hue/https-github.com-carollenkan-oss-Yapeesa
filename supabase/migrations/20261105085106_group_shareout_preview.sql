-- Pure numeric allocation: independently tested against the TypeScript calculator.
-- Numeric intermediates avoid bigint overflow before division. No journal writes.
create function private.shareout_allocation(p_fund text,p_members jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare total numeric; allocated jsonb;
begin
 if p_fund is null or p_fund !~ '^(0|[1-9][0-9]{0,18})$' or p_fund::numeric>9223372036854775807 or jsonb_typeof(p_members) is distinct from 'array' then raise exception 'Invalid fund or members' using errcode='22023'; end if;
 if jsonb_array_length(p_members)>5000 then raise exception 'Too many members' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_members) m where jsonb_typeof(m) is distinct from 'object' or (m->>'id') is null or (m->>'id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or (m->>'shares') is null or (m->>'shares') !~ '^(0|[1-9][0-9]{0,18})$') or (select count(*)<>count(distinct m->>'id') from jsonb_array_elements(p_members) m) then raise exception 'Invalid members' using errcode='22023'; end if;
 select coalesce(sum((m->>'shares')::numeric),0) into total from jsonb_array_elements(p_members) m;
 if total=0 and p_fund::numeric<>0 then raise exception 'Fund has no shares' using errcode='22023'; end if;
 with quotas as (
   select m->>'id' as id, case when total=0 then 0 else div(p_fund::numeric*(m->>'shares')::numeric,total) end as base,
     case when total=0 then 0 else mod(p_fund::numeric*(m->>'shares')::numeric,total) end as remainder
   from jsonb_array_elements(p_members) m
 ), ranked as (
   select *,row_number() over(order by remainder desc,id collate "C") as rank,p_fund::numeric-sum(base) over() as residual from quotas
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'amount',(base+case when rank<=residual then 1 else 0 end)::text) order by id collate "C"),'[]'::jsonb) into allocated from ranked;
 return allocated;
end $$;
revoke all on function private.shareout_allocation(text,jsonb) from public,anon,authenticated;
grant execute on function private.shareout_allocation(text,jsonb) to authenticated;

create function public.group_shareout_preview(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare org public.organisation; cyc public.cycle; members jsonb; allocations jsonb; fund numeric; recorded numeric; shares numeric;
begin
 if not private.is_officer(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select * into strict org from public.organisation where id=p_org and type='group' and status='active';
 select * into strict cyc from public.cycle where organisation_id=p_org and status='active';
 -- Fail closed if later posting types are introduced without extending this preview.
 if exists(select 1 from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=p_org and a.code not in ('cash','share_capital')) then raise exception 'Unsupported fund composition' using errcode='22023'; end if;
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
revoke all on function public.group_shareout_preview(uuid) from public,anon,authenticated;
grant execute on function public.group_shareout_preview(uuid) to authenticated;

create or replace function public.group_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb; begin
 if not private.can_read_org(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select jsonb_build_object(
 'group',jsonb_build_object('id',o.id,'name',o.name,'currency',o.currency,'time_zone',o.time_zone,'country_code',o.country_code,'minor_digits',cr.minor_digits,'max_shares',gs.max_shares_per_meeting::text,'can_record',private.can_record(o.id),'can_preview_shareout',private.is_officer(o.id)),
 'cycle',(select jsonb_build_object('id',c.id,'starts_on',c.starts_on,'ends_on',c.ends_on,'share_price',c.share_price::text) from public.cycle c where c.organisation_id=o.id and c.status='active'),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'active',exists(select 1 from public.membership m where m.person_id=p.id and m.organisation_id=o.id and m.role='member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))) order by p.display_name) from public.person p where exists(select 1 from public.membership m where m.person_id=p.id and m.organisation_id=o.id and m.role='member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())) or exists(select 1 from public.group_txn t where t.member_id=p.id and t.organisation_id=o.id)),'[]'::jsonb),
 'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'member_id',t.member_id,'meeting_date',m.meeting_date,'recorded_at',t.recorded_at,'shares',t.shares::text,'amount',t.amount::text,'currency',t.currency,'journal_id',t.journal_id,'calculation_mismatch',t.calculation_mismatch,'note',t.note,'reverses',t.reverses) order by t.recorded_at desc) from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.organisation_id=o.id),'[]'::jsonb),
 'journal_lines',coalesce((select jsonb_agg(jsonb_build_object('journal_id',l.journal_id,'account',a.code,'side',l.side,'amount',l.amount::text)) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=o.id),'[]'::jsonb)) into data
 from public.organisation o join public.currency_reference cr on cr.code=o.currency join public.group_settings gs on gs.organisation_id=o.id where o.id=p_org and o.type='group' and o.status='active';
 return data;
end $$;
