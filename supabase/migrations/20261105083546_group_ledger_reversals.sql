-- A correction is a new signed transaction and an exact opposite journal.
-- Original records, receipts and journal lines remain immutable.
alter table public.group_txn drop constraint group_txn_shares_check;
alter table public.group_txn drop constraint group_txn_amount_check;
alter table public.group_txn add column reverses uuid;
alter table public.group_txn add constraint group_txn_id_org unique(id,organisation_id);
alter table public.group_txn add constraint group_txn_reversal_org foreign key(reverses,organisation_id) references public.group_txn(id,organisation_id);
alter table public.group_txn add constraint group_txn_signed check(
 (reverses is null and shares>0 and amount>0) or
 (reverses is not null and reverses<>id and shares<0 and amount<0)
);
create unique index one_reversal_per_transaction on public.group_txn(reverses) where reverses is not null;

create function private.reverse_share_purchase(p_org uuid,p_transaction uuid,p_client uuid,p_device uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare original public.group_txn; prior public.sync_receipt; settings public.group_settings;
 request_data jsonb; result_data jsonb; actor uuid; txn_uuid uuid:=gen_random_uuid(); journal_uuid uuid:=gen_random_uuid();
begin
 if not private.can_record(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 actor:=private.current_person();
 if p_client is null or p_client::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or p_device is null or p_transaction is null or p_reason is null or length(btrim(p_reason)) not between 1 and 240 then raise exception 'Invalid reversal' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 request_data:=jsonb_build_object('action','reverse_shares','organisation_id',p_org,'transaction_id',p_transaction,'device_id',p_device,'reason',p_reason,'actor_id',actor);
 select * into prior from public.sync_receipt where client_id=p_client;
 if found then
   if prior.organisation_id<>p_org or prior.request<>request_data then raise exception 'Idempotency conflict' using errcode='23505'; end if;
   return prior.result;
 end if;
 select * into strict original from public.group_txn where id=p_transaction and organisation_id=p_org;
 if original.reverses is not null then raise exception 'Cannot reverse a reversal' using errcode='22023'; end if;
 if exists(select 1 from public.group_txn where reverses=original.id) then raise exception 'Already reversed' using errcode='23505'; end if;
 if not exists(select 1 from public.organisation where id=p_org and type='group' and status='active') or not exists(select 1 from public.meeting m join public.cycle c on c.id=m.cycle_id where m.id=original.meeting_id and m.status='open' and c.status='active') then raise exception 'Meeting or cycle is closed' using errcode='22023'; end if;
 select * into strict settings from public.group_settings where organisation_id=p_org;
 if settings.writer_device_id is distinct from p_device then raise exception 'Writer device transfer required' using errcode='42501'; end if;
 -- Copy account IDs and amounts; never reprice an old entry or trust client money.
 insert into public.journal(id,organisation_id,currency,calc_version) values(journal_uuid,p_org,original.currency,'groups-shares-reversal-v1');
 insert into public.journal_line(organisation_id,journal_id,account_id,side,amount)
 select organisation_id,journal_uuid,account_id,case when side='debit' then 'credit' else 'debit' end,amount from public.journal_line where journal_id=original.journal_id and organisation_id=p_org;
 insert into public.group_txn(id,organisation_id,meeting_id,member_id,client_id,device_id,shares,amount,currency,entered_by,journal_id,note,calc_version,client_calc_version,client_amount,calculation_mismatch,reverses)
 values(txn_uuid,p_org,original.meeting_id,original.member_id,p_client,p_device,-original.shares,-original.amount,original.currency,actor,journal_uuid,p_reason,'groups-shares-reversal-v1','groups-shares-reversal-v1',(-original.amount)::text,false,original.id);
 result_data:=jsonb_build_object('transaction_id',txn_uuid,'journal_id',journal_uuid,'client_id',p_client,'amount',(-original.amount)::text,'currency',original.currency,'calculation_mismatch',false,'calc_version','groups-shares-reversal-v1');
 insert into public.sync_receipt(client_id,organisation_id,request,result) values(p_client,p_org,request_data,result_data);
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(p_org,actor,p_device,'reverse_shares',txn_uuid,request_data||result_data);
 return result_data;
end $$;
grant create on schema private to yapesa_poster;
alter function private.reverse_share_purchase(uuid,uuid,uuid,uuid,text) owner to yapesa_poster;
revoke create on schema private from yapesa_poster;
revoke all on function private.reverse_share_purchase(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.reverse_share_purchase(uuid,uuid,uuid,uuid,text) to authenticated;
create function public.reverse_share_purchase(p_org uuid,p_transaction uuid,p_client uuid,p_device uuid,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$ select private.reverse_share_purchase(p_org,p_transaction,p_client,p_device,p_reason); $$;
revoke all on function public.reverse_share_purchase(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reverse_share_purchase(uuid,uuid,uuid,uuid,text) to authenticated;

create or replace function public.group_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb; begin
 if not private.can_read_org(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select jsonb_build_object(
 'group',jsonb_build_object('id',o.id,'name',o.name,'currency',o.currency,'time_zone',o.time_zone,'country_code',o.country_code,'minor_digits',cr.minor_digits,'max_shares',gs.max_shares_per_meeting::text,'can_record',private.can_record(o.id)),
 'cycle',(select jsonb_build_object('id',c.id,'starts_on',c.starts_on,'ends_on',c.ends_on,'share_price',c.share_price::text) from public.cycle c where c.organisation_id=o.id and c.status='active'),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'active',exists(select 1 from public.membership m where m.person_id=p.id and m.organisation_id=o.id and m.role='member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))) order by p.display_name) from public.person p where exists(select 1 from public.membership m where m.person_id=p.id and m.organisation_id=o.id and m.role='member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())) or exists(select 1 from public.group_txn t where t.member_id=p.id and t.organisation_id=o.id)),'[]'::jsonb),
 'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'member_id',t.member_id,'meeting_date',m.meeting_date,'recorded_at',t.recorded_at,'shares',t.shares::text,'amount',t.amount::text,'currency',t.currency,'journal_id',t.journal_id,'calculation_mismatch',t.calculation_mismatch,'note',t.note,'reverses',t.reverses) order by t.recorded_at desc) from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.organisation_id=o.id),'[]'::jsonb),
 'journal_lines',coalesce((select jsonb_agg(jsonb_build_object('journal_id',l.journal_id,'account',a.code,'side',l.side,'amount',l.amount::text)) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=o.id),'[]'::jsonb)) into data
 from public.organisation o join public.currency_reference cr on cr.code=o.currency join public.group_settings gs on gs.organisation_id=o.id where o.id=p_org and o.type='group' and o.status='active';
 return data;
end $$;
