-- First online Groups workflow. No account/role provisioning is exposed publicly.
create schema if not exists private;
revoke all on schema private from public;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='yapesa_poster') then
    create role yapesa_poster nologin noinherit nobypassrls;
  end if;
end $$;
grant yapesa_poster to postgres;
create table public.currency_reference(code text primary key check(code ~ '^[A-Z]{3}$'), minor_digits integer not null check(minor_digits between 0 and 4));
insert into public.currency_reference values ('UGX',0);
create table public.person(
  id uuid primary key default gen_random_uuid(), auth_user_id uuid unique references auth.users(id),
  display_name text not null check(length(display_name) between 1 and 150), phone text unique check(phone ~ '^\+[1-9][0-9]{6,14}$'), country_code text not null check(country_code ~ '^[A-Z]{2}$')
);
create table public.organisation(
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 200),
  type text not null check(type in ('group','lender','sacco','programme','fencher')), country_code text not null check(country_code ~ '^[A-Z]{2}$'),
  currency text not null references public.currency_reference(code), time_zone text not null, status text not null default 'active' check(status in ('active','inactive')),
  unique(id,currency)
);
create table public.membership(
  person_id uuid not null references public.person(id), organisation_id uuid not null references public.organisation(id),
  role text not null check(role in ('member','secretary','treasurer','chair','field_officer','loan_officer','teller','accountant','manager','programme_officer','fencher_admin')),
  starts_at timestamptz not null default now(), ends_at timestamptz, primary key(person_id,organisation_id,role), check(ends_at is null or ends_at>starts_at)
);
create index membership_org_person on public.membership(organisation_id,person_id);
create table public.role_permission(role text not null, action text not null, primary key(role,action));
insert into public.role_permission values ('secretary','record_shares');
create table public.device(id uuid primary key, organisation_id uuid not null references public.organisation(id), registered_by uuid not null references public.person(id), created_at timestamptz not null default now(), unique(id,organisation_id));
create table public.group_settings(
  organisation_id uuid primary key references public.organisation(id), max_shares_per_meeting bigint not null default 5 check(max_shares_per_meeting>0), writer_device_id uuid,
  foreign key(writer_device_id,organisation_id) references public.device(id,organisation_id)
);
create table public.cycle(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), starts_on date not null, ends_on date not null,
  share_price bigint not null check(share_price>0), status text not null default 'active' check(status in ('active','closed')), check(ends_on>=starts_on), unique(id,organisation_id)
);
create unique index one_active_cycle on public.cycle(organisation_id) where status='active';
create table public.meeting(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), cycle_id uuid not null,
  meeting_date date not null, status text not null default 'open' check(status in ('open','closed')), unique(id,organisation_id), unique(cycle_id,meeting_date),
  foreign key(cycle_id,organisation_id) references public.cycle(id,organisation_id)
);
create table public.ledger_account(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), code text not null check(code in ('cash','share_capital')),
  unique(organisation_id,code), unique(id,organisation_id)
);
create table public.journal(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null, currency text not null, created_at timestamptz not null default now(),
  calc_version text not null, unique(id,organisation_id), foreign key(organisation_id,currency) references public.organisation(id,currency)
);
create table public.journal_line(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null, journal_id uuid not null, account_id uuid not null,
  side text not null check(side in ('debit','credit')), amount bigint not null check(amount>0),
  foreign key(journal_id,organisation_id) references public.journal(id,organisation_id), foreign key(account_id,organisation_id) references public.ledger_account(id,organisation_id)
);
create index journal_line_journal on public.journal_line(journal_id);
create index journal_line_account on public.journal_line(account_id);
create table public.group_txn(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null, meeting_id uuid not null, member_id uuid not null references public.person(id),
  client_id uuid not null unique, device_id uuid not null, shares bigint not null check(shares>0), amount bigint not null check(amount>0), currency text not null,
  entered_by uuid not null references public.person(id), journal_id uuid not null unique, recorded_at timestamptz not null default now(), note text not null default '' check(length(note)<=240),
  calc_version text not null, client_calc_version text not null, client_amount text not null, calculation_mismatch boolean not null,
  foreign key(organisation_id,currency) references public.organisation(id,currency), foreign key(meeting_id,organisation_id) references public.meeting(id,organisation_id),
  foreign key(device_id,organisation_id) references public.device(id,organisation_id), foreign key(journal_id,organisation_id) references public.journal(id,organisation_id)
);
create index group_txn_member_meeting on public.group_txn(organisation_id,member_id,meeting_id);
create table public.sync_receipt(client_id uuid primary key, organisation_id uuid not null references public.organisation(id), request jsonb not null, result jsonb not null, accepted_at timestamptz not null default now());
create table public.audit_log(id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisation(id), actor_id uuid not null references public.person(id), device_id uuid not null, action text not null, record_id uuid not null, occurred_at timestamptz not null default now(), after_value jsonb not null);
create table private.gateway_key(id boolean primary key default true check(id), key_hash text not null check(key_hash ~ '^[a-f0-9]{64}$'));
create table private.pin_attempt(phone text primary key, attempts integer not null check(attempts between 0 and 6), updated_at timestamptz not null default now());
alter table private.gateway_key enable row level security;
alter table private.pin_attempt enable row level security;

-- The anonymous login gateway is a narrowly scoped exception to auth.uid checks:
-- it requires a separate 256-bit server secret, stores no PIN, and returns no user data.
create function private.gateway_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.gateway_key where key_hash=encode(extensions.digest(coalesce((current_setting('request.headers',true)::jsonb)->>'x-yapesa-auth',''),'sha256'),'hex'));
$$;
create function private.pin_attempt_begin(p_phone text) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; begin
 if not private.gateway_allowed() then raise exception 'Gateway access denied' using errcode='42501'; end if;
 if p_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Invalid phone'; end if;
 insert into private.pin_attempt(phone,attempts) values(p_phone,1) on conflict(phone) do update set attempts=least(private.pin_attempt.attempts+1,6),updated_at=now() returning attempts into n;
 return n<=5;
end $$;
create function private.pin_attempt_clear(p_phone text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.gateway_allowed() then raise exception 'Gateway access denied' using errcode='42501'; end if;
 delete from private.pin_attempt where phone=p_phone;
end $$;
create function public.pin_attempt_begin(p_phone text) returns boolean language sql security invoker set search_path='' as $$ select private.pin_attempt_begin(p_phone) $$;
create function public.pin_attempt_clear(p_phone text) returns void language sql security invoker set search_path='' as $$ select private.pin_attempt_clear(p_phone) $$;

-- These private lookup helpers avoid recursive membership RLS. Each is tied to
-- auth.uid() and a currently active Auth session, never user-editable metadata.
create function private.session_active(p_mfa boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
   select 1 from auth.sessions s where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now())
   and (not p_mfa or ((auth.jwt()->>'aal')='aal2' and s.aal::text='aal2' and exists(select 1 from auth.mfa_factors f where f.id=s.factor_id and f.user_id=s.user_id and f.status::text='verified')))
 );
$$;
create function private.current_person() returns uuid language sql stable security definer set search_path='' as $$ select id from public.person where auth_user_id=auth.uid() and private.session_active(false) $$;
create function private.has_role(p_org uuid,p_roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.membership m join public.person p on p.id=m.person_id where p.auth_user_id=auth.uid() and m.organisation_id=p_org and m.role=any(p_roles) and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()));
$$;
create function private.requires_mfa() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.membership m join public.person p on p.id=m.person_id where p.auth_user_id=auth.uid() and m.role<>'member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()));
$$;
create function private.can_read_org(p_org uuid) returns boolean language sql stable set search_path='' as $$ select private.session_active(private.requires_mfa()) and private.has_role(p_org,array['member','secretary','treasurer','chair']); $$;
create function private.is_officer(p_org uuid) returns boolean language sql stable set search_path='' as $$ select private.session_active(true) and private.has_role(p_org,array['secretary','treasurer','chair']); $$;
create function private.can_record(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.session_active(true) and exists(select 1 from public.membership m join public.person p on p.id=m.person_id join public.role_permission rp on rp.role=m.role and rp.action='record_shares' where p.auth_user_id=auth.uid() and m.organisation_id=p_org and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()));
$$;
create function private.person_visible(p_person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.session_active(private.requires_mfa()) and (p_person=private.current_person() or exists(select 1 from public.membership m where m.person_id=p_person and private.is_officer(m.organisation_id) and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())));
$$;
create function private.can_read_journal(p_journal uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.group_txn t where t.journal_id=p_journal and private.can_read_org(t.organisation_id) and (t.member_id=private.current_person() or private.is_officer(t.organisation_id)));
$$;

-- Every exposed table uses explicit grants plus RLS. Clients have no table-write
-- grants; journal postings can only be created by the narrowly privileged RPC.
do $$ declare tbl text; begin
 foreach tbl in array array['currency_reference','person','organisation','membership','role_permission','device','group_settings','cycle','meeting','ledger_account','journal','journal_line','group_txn','sync_receipt','audit_log'] loop
   execute format('alter table public.%I enable row level security',tbl);
   execute format('revoke all on public.%I from anon, authenticated',tbl);
   execute format('grant select on public.%I to authenticated',tbl);
 end loop;
end $$;
create policy currency_read on public.currency_reference for select to authenticated using(private.session_active(false));
create policy permissions_read on public.role_permission for select to authenticated using(private.session_active(false));
create policy person_read on public.person for select to authenticated using(id=private.current_person() or private.person_visible(id));
create policy organisation_read on public.organisation for select to authenticated using(private.can_read_org(id));
create policy membership_read on public.membership for select to authenticated using(person_id=private.current_person() or private.is_officer(organisation_id));
create policy settings_read on public.group_settings for select to authenticated using(private.can_read_org(organisation_id));
create policy cycle_read on public.cycle for select to authenticated using(private.can_read_org(organisation_id));
create policy meeting_read on public.meeting for select to authenticated using(private.can_read_org(organisation_id));
create policy account_read on public.ledger_account for select to authenticated using(private.can_read_org(organisation_id));
create policy device_read on public.device for select to authenticated using(private.is_officer(organisation_id));
create policy txn_read on public.group_txn for select to authenticated using(private.can_read_org(organisation_id) and (member_id=private.current_person() or private.is_officer(organisation_id)));
create policy journal_read on public.journal for select to authenticated using(private.can_read_journal(id));
create policy line_read on public.journal_line for select to authenticated using(private.can_read_journal(journal_id));
create policy receipt_read on public.sync_receipt for select to authenticated using(private.is_officer(organisation_id));
create policy audit_read on public.audit_log for select to authenticated using(private.is_officer(organisation_id));

create function private.immutable_record() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Append-only record' using errcode='55000'; end $$;
do $$ declare tbl text; begin
 foreach tbl in array array['group_txn','journal','journal_line','sync_receipt','audit_log'] loop
   execute format('create trigger immutable_record before update or delete on public.%I for each row execute function private.immutable_record()',tbl);
 end loop;
end $$;
create function private.check_journal() returns trigger language plpgsql set search_path='' as $$
declare target uuid; n bigint; debit numeric; credit numeric; begin
 target:=case when tg_table_name='journal' then new.id else new.journal_id end;
 select count(*),coalesce(sum(amount) filter(where side='debit'),0),coalesce(sum(amount) filter(where side='credit'),0) into n,debit,credit from public.journal_line where journal_id=target;
 if n<2 or debit<>credit then raise exception 'Journal must balance' using errcode='23514'; end if;
 return null;
end $$;
create constraint trigger journal_balanced after insert on public.journal deferrable initially deferred for each row execute function private.check_journal();
create constraint trigger lines_balanced after insert on public.journal_line deferrable initially deferred for each row execute function private.check_journal();
create function private.preserve_cycle_price() returns trigger language plpgsql set search_path='' as $$ begin
 if old.share_price<>new.share_price then raise exception 'Cycle share price cannot change'; end if; return new;
end $$;
create trigger cycle_price_immutable before update on public.cycle for each row execute function private.preserve_cycle_price();
create function private.validate_zone() returns trigger language plpgsql set search_path='' as $$ begin
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.time_zone) then raise exception 'Invalid time zone'; end if; return new;
end $$;
create trigger valid_time_zone before insert or update on public.organisation for each row execute function private.validate_zone();
create function private.share_amount(p_price text,p_shares text) returns bigint language plpgsql immutable set search_path='' as $$
declare n numeric; begin
 if p_price !~ '^[1-9][0-9]{0,18}$' or p_shares !~ '^[1-9][0-9]{0,18}$' then raise exception 'Invalid integer amount'; end if;
 n:=p_price::numeric*p_shares::numeric;
 if n>9223372036854775807 then raise exception 'Amount overflow'; end if; return n::bigint;
end $$;

-- No LOGIN, no BYPASSRLS, and no UPDATE/DELETE privileges for the posting role.
grant usage on schema public,private,auth to yapesa_poster;
grant select on public.organisation,public.membership,public.person,public.role_permission,public.group_settings,public.cycle,public.device,public.meeting,public.ledger_account,public.journal,public.journal_line,public.group_txn,public.sync_receipt,public.audit_log to yapesa_poster;
grant insert on public.device,public.meeting,public.journal,public.journal_line,public.group_txn,public.sync_receipt,public.audit_log to yapesa_poster;
grant update(writer_device_id) on public.group_settings to yapesa_poster;
do $$ declare tbl text; begin
 foreach tbl in array array['person','membership','role_permission'] loop execute format('create policy poster_lookup on public.%I for select to yapesa_poster using (private.session_active(true))',tbl); end loop;
 foreach tbl in array array['organisation','group_settings','cycle','device','meeting','ledger_account','journal','journal_line','group_txn','sync_receipt','audit_log'] loop
   execute format('create policy poster_read on public.%I for select to yapesa_poster using (private.can_record(%I))',tbl,case when tbl='organisation' then 'id' else 'organisation_id' end);
 end loop;
 foreach tbl in array array['device','meeting','journal','journal_line','group_txn','sync_receipt','audit_log'] loop execute format('create policy poster_insert on public.%I for insert to yapesa_poster with check(private.can_record(organisation_id))',tbl); end loop;
end $$;
create policy poster_settings_update on public.group_settings for update to yapesa_poster using(private.can_record(organisation_id)) with check(private.can_record(organisation_id));
create function private.post_share_purchase(p_org uuid,p_member uuid,p_date date,p_shares text,p_client uuid,p_device uuid,p_client_amount text,p_client_version text,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org public.organisation; cyc public.cycle; settings public.group_settings; prior public.sync_receipt; request_data jsonb; result_data jsonb; meeting_row public.meeting;
 amount_value bigint; share_count bigint; already_bought numeric; journal_uuid uuid:=gen_random_uuid(); txn_uuid uuid:=gen_random_uuid(); actor uuid; mismatch boolean;
begin
 if not private.can_record(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 actor:=private.current_person();
 if p_client::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then raise exception 'UUID v7 required' using errcode='22023'; end if;
 if p_note is null or length(p_note)>240 or p_client_version is null or length(p_client_version) not between 1 and 64 or p_client_amount !~ '^(0|[1-9][0-9]{0,18})$' then raise exception 'Invalid request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 request_data:=jsonb_build_object('organisation_id',p_org,'member_id',p_member,'meeting_date',p_date,'shares',p_shares,'device_id',p_device,'client_amount',p_client_amount,'client_calc_version',p_client_version,'note',p_note);
 select * into prior from public.sync_receipt where client_id=p_client;
 if found then
   if prior.organisation_id<>p_org or prior.request<>request_data then raise exception 'Idempotency conflict' using errcode='23505'; end if;
   return prior.result;
 end if;
 select * into strict org from public.organisation where id=p_org and type='group' and status='active';
 select * into strict cyc from public.cycle where organisation_id=p_org and status='active' and p_date between starts_on and ends_on;
 select * into strict settings from public.group_settings where organisation_id=p_org;
 if not exists(select 1 from public.membership where person_id=p_member and organisation_id=p_org and role='member' and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'Invalid member' using errcode='22023'; end if;
 amount_value:=private.share_amount(cyc.share_price::text,p_shares); share_count:=p_shares::bigint;
 if settings.writer_device_id is not null and settings.writer_device_id<>p_device then raise exception 'Writer device transfer required' using errcode='42501'; end if;
 if not exists(select 1 from public.device where id=p_device and organisation_id=p_org) then insert into public.device(id,organisation_id,registered_by) values(p_device,p_org,actor); end if;
 if settings.writer_device_id is null then update public.group_settings set writer_device_id=p_device where organisation_id=p_org; end if;
 select * into meeting_row from public.meeting where cycle_id=cyc.id and meeting_date=p_date;
 if not found then insert into public.meeting(organisation_id,cycle_id,meeting_date) values(p_org,cyc.id,p_date) returning * into meeting_row; end if;
 if meeting_row.status<>'open' then raise exception 'Meeting is closed' using errcode='22023'; end if;
 select coalesce(sum(shares),0) into already_bought from public.group_txn where meeting_id=meeting_row.id and member_id=p_member;
 if already_bought+share_count>settings.max_shares_per_meeting then raise exception 'Meeting share limit exceeded' using errcode='22023'; end if;
 mismatch:=(p_client_amount<>amount_value::text or p_client_version<>'groups-shares-v1');
 insert into public.journal(id,organisation_id,currency,calc_version) values(journal_uuid,p_org,org.currency,'groups-shares-v1');
 insert into public.journal_line(organisation_id,journal_id,account_id,side,amount)
 select p_org,journal_uuid,id,case when code='cash' then 'debit' else 'credit' end,amount_value from public.ledger_account where organisation_id=p_org and code in ('cash','share_capital');
 if (select count(*) from public.journal_line where journal_id=journal_uuid)<>2 then raise exception 'Chart of accounts incomplete' using errcode='23514'; end if;
 insert into public.group_txn(id,organisation_id,meeting_id,member_id,client_id,device_id,shares,amount,currency,entered_by,journal_id,note,calc_version,client_calc_version,client_amount,calculation_mismatch)
 values(txn_uuid,p_org,meeting_row.id,p_member,p_client,p_device,share_count,amount_value,org.currency,actor,journal_uuid,p_note,'groups-shares-v1',p_client_version,p_client_amount,mismatch);
 result_data:=jsonb_build_object('transaction_id',txn_uuid,'journal_id',journal_uuid,'client_id',p_client,'amount',amount_value::text,'currency',org.currency,'calculation_mismatch',mismatch,'calc_version','groups-shares-v1');
 insert into public.sync_receipt(client_id,organisation_id,request,result) values(p_client,p_org,request_data,result_data);
 insert into public.audit_log(organisation_id,actor_id,device_id,action,record_id,after_value) values(p_org,actor,p_device,'record_shares',txn_uuid,request_data||result_data);
 return result_data;
end $$;
grant create on schema private to yapesa_poster;
alter function private.post_share_purchase(uuid,uuid,date,text,uuid,uuid,text,text,text) owner to yapesa_poster;
revoke create on schema private from yapesa_poster;
create function public.post_share_purchase(p_org uuid,p_member uuid,p_date date,p_shares text,p_client uuid,p_device uuid,p_client_amount text,p_client_version text,p_note text)
returns jsonb language sql security invoker set search_path='' as $$ select private.post_share_purchase(p_org,p_member,p_date,p_shares,p_client,p_device,p_client_amount,p_client_version,p_note); $$;
create function public.session_context() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('person_id',p.id,'display_name',p.display_name,'requires_mfa',private.requires_mfa(),'mfa_verified',private.session_active(true)) from public.person p where p.id=private.current_person();
$$;
create function public.list_my_groups() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'currency',o.currency,'time_zone',o.time_zone,'country_code',o.country_code,'minor_digits',c.minor_digits,'can_record',private.can_record(o.id)) order by o.name),'[]'::jsonb)
 from public.organisation o join public.currency_reference c on c.code=o.currency where o.type='group' and o.status='active';
$$;
create function public.group_workspace(p_org uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb; begin
 if not private.can_read_org(p_org) then raise exception 'Not permitted' using errcode='42501'; end if;
 select jsonb_build_object(
 'group',jsonb_build_object('id',o.id,'name',o.name,'currency',o.currency,'time_zone',o.time_zone,'country_code',o.country_code,'minor_digits',cr.minor_digits,'max_shares',gs.max_shares_per_meeting::text,'can_record',private.can_record(o.id)),
 'cycle',(select jsonb_build_object('id',c.id,'starts_on',c.starts_on,'ends_on',c.ends_on,'share_price',c.share_price::text) from public.cycle c where c.organisation_id=o.id and c.status='active'),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) order by p.display_name) from public.person p where exists(select 1 from public.membership m where m.person_id=p.id and m.organisation_id=o.id and m.role='member' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()))),'[]'::jsonb),
 'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'member_id',t.member_id,'meeting_date',m.meeting_date,'recorded_at',t.recorded_at,'shares',t.shares::text,'amount',t.amount::text,'currency',t.currency,'journal_id',t.journal_id,'calculation_mismatch',t.calculation_mismatch,'note',t.note) order by t.recorded_at desc) from public.group_txn t join public.meeting m on m.id=t.meeting_id where t.organisation_id=o.id),'[]'::jsonb),
 'journal_lines',coalesce((select jsonb_agg(jsonb_build_object('journal_id',l.journal_id,'account',a.code,'side',l.side,'amount',l.amount::text)) from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=o.id),'[]'::jsonb)) into data
 from public.organisation o join public.currency_reference cr on cr.code=o.currency join public.group_settings gs on gs.organisation_id=o.id where o.id=p_org and o.type='group' and o.status='active';
 return data;
end $$;
-- Revoke default function access explicitly; private is not a Data API schema.
revoke all on all tables in schema private from public,anon,authenticated,yapesa_poster;
revoke all on all functions in schema private from public,anon,authenticated,yapesa_poster;
grant usage on schema private to anon,authenticated,yapesa_poster;
grant execute on function private.pin_attempt_begin(text),private.pin_attempt_clear(text) to anon;
grant execute on function private.session_active(boolean),private.current_person(),private.has_role(uuid,text[]),private.requires_mfa(),private.can_read_org(uuid),private.is_officer(uuid),private.can_record(uuid),private.person_visible(uuid),private.can_read_journal(uuid) to authenticated,yapesa_poster;
grant execute on function private.share_amount(text,text) to yapesa_poster;
grant execute on function private.post_share_purchase(uuid,uuid,date,text,uuid,uuid,text,text,text) to authenticated;
revoke all on function public.pin_attempt_begin(text),public.pin_attempt_clear(text),public.post_share_purchase(uuid,uuid,date,text,uuid,uuid,text,text,text),public.session_context(),public.list_my_groups(),public.group_workspace(uuid) from public,anon,authenticated;
grant execute on function public.pin_attempt_begin(text),public.pin_attempt_clear(text) to anon;
grant execute on function public.post_share_purchase(uuid,uuid,date,text,uuid,uuid,text,text,text),public.session_context(),public.list_my_groups(),public.group_workspace(uuid) to authenticated;
