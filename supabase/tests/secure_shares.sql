-- Synthetic fixtures exist only inside this transaction; no customer rows remain.
begin;
create temporary table fixture(k text primary key,v uuid);
grant select on fixture to authenticated,anon,yapesa_poster;
insert into fixture select k,gen_random_uuid() from unnest(array['auth_a','auth_b','auth_m','person_a','person_b','person_m','org_a','org_b','cycle_a','cycle_b','session_a','session_b','session_m','factor_a','factor_b','device_a','device_b','client_a','client_b','bad_journal']) k;
update fixture set v=overlay(v::text placing '7' from 15 for 1)::uuid where k like 'client_%';
create function pg_temp.f(k text) returns uuid language sql stable as $$ select v from fixture where fixture.k=f.k $$;
create function pg_temp.check_true(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'TEST FAILED: %',msg; end if; end $$;
create function pg_temp.claim(who text,mfa boolean default true) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.f('auth_'||who),'role','authenticated','session_id',pg_temp.f('session_'||who),'aal',case when mfa then 'aal2' else 'aal1' end)::text,true);
end $$;
insert into auth.users(id,aud,role,created_at,updated_at) select pg_temp.f('auth_'||n),'authenticated','authenticated',now(),now() from unnest(array['a','b','m']) n;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(pg_temp.f('factor_a'),pg_temp.f('auth_a'),'totp','verified',now(),now()),(pg_temp.f('factor_b'),pg_temp.f('auth_b'),'totp','verified',now(),now());
insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at) values(pg_temp.f('session_a'),pg_temp.f('auth_a'),'aal2',pg_temp.f('factor_a'),now(),now()),(pg_temp.f('session_b'),pg_temp.f('auth_b'),'aal2',pg_temp.f('factor_b'),now(),now()),(pg_temp.f('session_m'),pg_temp.f('auth_m'),'aal1',null,now(),now());
insert into public.person(id,auth_user_id,display_name,country_code) values(pg_temp.f('person_a'),pg_temp.f('auth_a'),'Fixture secretary A','UG'),(pg_temp.f('person_b'),pg_temp.f('auth_b'),'Fixture secretary B','UG'),(pg_temp.f('person_m'),pg_temp.f('auth_m'),'Fixture member','UG');
insert into public.organisation(id,name,type,country_code,currency,time_zone) values(pg_temp.f('org_a'),'Fixture A','group','UG','UGX','Africa/Kampala'),(pg_temp.f('org_b'),'Fixture B','group','UG','UGX','Africa/Kampala');
insert into public.membership(person_id,organisation_id,role,starts_at) values(pg_temp.f('person_a'),pg_temp.f('org_a'),'secretary',now()-interval '1 day'),(pg_temp.f('person_a'),pg_temp.f('org_a'),'member',now()-interval '1 day'),(pg_temp.f('person_m'),pg_temp.f('org_a'),'member',now()-interval '1 day'),(pg_temp.f('person_b'),pg_temp.f('org_b'),'secretary',now()-interval '1 day'),(pg_temp.f('person_b'),pg_temp.f('org_b'),'member',now()-interval '1 day');
insert into public.group_settings(organisation_id) values(pg_temp.f('org_a')),(pg_temp.f('org_b'));
insert into public.cycle(id,organisation_id,starts_on,ends_on,share_price) values(pg_temp.f('cycle_a'),pg_temp.f('org_a'),current_date-30,current_date+330,5000),(pg_temp.f('cycle_b'),pg_temp.f('org_b'),current_date-30,current_date+330,10000);
insert into public.ledger_account(organisation_id,code) select pg_temp.f('org_'||g),c from unnest(array['a','b']) g cross join unnest(array['cash','share_capital']) c;
select pg_temp.claim('b');
set local role authenticated;
select public.post_share_purchase(pg_temp.f('org_b'),pg_temp.f('person_b'),current_date,'1',pg_temp.f('client_b'),pg_temp.f('device_b'),'10000','groups-shares-v1','fixture B');
reset role;
select pg_temp.claim('a',false);
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.organisation),'staff needs MFA before reading groups');
do $$ begin
 begin perform public.post_share_purchase(pg_temp.f('org_a'),pg_temp.f('person_a'),current_date,'2',pg_temp.f('client_a'),pg_temp.f('device_a'),'10000','groups-shares-v1','fixture A');raise exception 'MFA bypass';exception when insufficient_privilege then null;end;
end $$;
reset role;
select pg_temp.claim('a');
set local role authenticated;
select public.post_share_purchase(pg_temp.f('org_a'),pg_temp.f('person_a'),current_date,'2',pg_temp.f('client_a'),pg_temp.f('device_a'),'9999','old-version','fixture A');
select public.post_share_purchase(pg_temp.f('org_a'),pg_temp.f('person_a'),current_date,'2',pg_temp.f('client_a'),pg_temp.f('device_a'),'9999','old-version','fixture A');
select pg_temp.check_true((select count(*)=1 from public.group_txn),'duplicate request creates one transaction');
select pg_temp.check_true((select amount=10000 and client_amount='9999' and calculation_mismatch from public.group_txn),'server amount is authoritative; original amount retained and flagged');
select pg_temp.check_true((select count(*)=1 from public.sync_receipt),'one permanent receipt');
select pg_temp.check_true((select count(*)=2 from public.journal_line),'one two-line journal');
select pg_temp.check_true((select sum(case when side='debit' then amount else -amount end)=0 from public.journal_line),'journal balances');
do $$ begin
 begin perform public.post_share_purchase(pg_temp.f('org_a'),pg_temp.f('person_a'),current_date,'3',pg_temp.f('client_a'),pg_temp.f('device_a'),'15000','groups-shares-v1','changed');raise exception 'UUID payload conflict was accepted';exception when unique_violation then null;end;
 begin perform public.post_share_purchase(pg_temp.f('org_a'),pg_temp.f('person_a'),current_date,'4',overlay(gen_random_uuid()::text placing '7' from 15 for 1)::uuid,pg_temp.f('device_a'),'20000','groups-shares-v1','limit');raise exception 'Share limit bypass';exception when invalid_parameter_value then null;end;
 begin perform public.post_share_purchase(pg_temp.f('org_b'),pg_temp.f('person_b'),current_date,'1',overlay(gen_random_uuid()::text placing '7' from 15 for 1)::uuid,pg_temp.f('device_a'),'10000','groups-shares-v1','cross-org');raise exception 'Cross-organisation posting accepted';exception when insufficient_privilege then null;end;
 begin perform public.post_share_purchase(pg_temp.f('org_a'),pg_temp.f('person_a'),current_date,'1',overlay(gen_random_uuid()::text placing '7' from 15 for 1)::uuid,gen_random_uuid(),'5000','groups-shares-v1','other writer');raise exception 'Writer device bypass';exception when insufficient_privilege then null;end;
end $$;
select pg_temp.check_true((select count(*)=0 from public.person where id=pg_temp.f('person_b')),'cross-org person isolation');
select pg_temp.check_true((select count(*)=0 from public.organisation where id=pg_temp.f('org_b')),'organisation isolation');
do $$ declare tbl text;n bigint;begin
 foreach tbl in array array['membership','group_settings','cycle','meeting','device','ledger_account','journal','journal_line','group_txn','sync_receipt','audit_log'] loop
  execute format('select count(*) from public.%I where organisation_id=$1',tbl) into n using pg_temp.f('org_b');
  perform pg_temp.check_true(n=0,tbl||' organisation isolation');
 end loop;
end $$;
reset role;
-- Validate all table writes are unavailable to authenticated clients, even with a
-- structurally valid row copied by the test administrator from organisation B.
create temporary table write_payload(tbl text,row_data json);
grant select on write_payload to authenticated;
do $$ declare tbl text;payload json;begin
 foreach tbl in array array['person','organisation','membership','group_settings','cycle','meeting','device','ledger_account','journal','journal_line','group_txn','sync_receipt','audit_log'] loop
   execute format('select row_to_json(t) from public.%I t limit 1',tbl) into payload;
   insert into write_payload values(tbl,payload);
 end loop;
end $$;
set local role authenticated;
do $$ declare p record;begin
 for p in select * from write_payload loop
   begin execute format('insert into public.%I select (json_populate_record(null::public.%I,$1)).*',p.tbl,p.tbl) using p.row_data;raise exception 'Direct write allowed: %',p.tbl;exception when insufficient_privilege then null;end;
 end loop;
end $$;
reset role;
select pg_temp.claim('m',false);
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.group_txn),'member cannot see another member transactions');
do $$ begin
 begin perform public.post_share_purchase(pg_temp.f('org_a'),pg_temp.f('person_m'),current_date,'1',overlay(gen_random_uuid()::text placing '7' from 15 for 1)::uuid,pg_temp.f('device_a'),'5000','groups-shares-v1','member');raise exception 'Member posting allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Database constraints operate even for an administrative connection.
do $$ begin
 begin insert into public.journal(id,organisation_id,currency,calc_version) values(pg_temp.f('bad_journal'),pg_temp.f('org_a'),'UGX','test');
 insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select pg_temp.f('org_a'),pg_temp.f('bad_journal'),id,'debit',100 from public.ledger_account where organisation_id=pg_temp.f('org_a') and code='cash';
 set constraints all immediate;raise exception 'Unbalanced journal accepted';exception when check_violation then null;end;
end $$;
set constraints all deferred;
do $$ declare tbl text;begin
 foreach tbl in array array['group_txn','journal','journal_line','sync_receipt','audit_log'] loop
   begin execute format('delete from public.%I where organisation_id=$1',tbl) using pg_temp.f('org_a');raise exception 'Deletion allowed: %',tbl;exception when sqlstate '55000' then null;end;
 end loop;
 begin update public.group_txn set note=note where organisation_id=pg_temp.f('org_a');raise exception 'Editing accepted';exception when sqlstate '55000' then null;end;
 perform pg_temp.check_true(private.share_amount('4611686018427387903','2')=9223372036854775806,'bigint exact calculation');
 begin perform private.share_amount('9223372036854775807','2');raise exception 'Overflow accepted';exception when raise_exception then if sqlerrm='Overflow accepted' then raise;end if;end;
end $$;
-- Revoking the factor, membership or session invalidates access immediately.
select pg_temp.claim('a');
update auth.mfa_factors set status='unverified' where id=pg_temp.f('factor_a');
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.group_txn),'factor revocation immediately removes staff access');
reset role;
update auth.mfa_factors set status='verified' where id=pg_temp.f('factor_a');
update public.membership set ends_at=now()-interval '1 second' where person_id=pg_temp.f('person_a') and role='secretary';
set local role authenticated;
select pg_temp.check_true(not private.can_record(pg_temp.f('org_a')),'staff role revocation removes posting permission with unchanged JWT');
select pg_temp.check_true((select count(*)=1 from public.group_txn),'remaining member role preserves access to own transaction');
reset role;
delete from auth.sessions where id=pg_temp.f('session_a');
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.person),'revoked session cannot read its person row');
reset role;
-- The server-only gateway cannot be used without its separate credential.
create temporary table gateway_fixture(secret text);
insert into gateway_fixture values(encode(extensions.gen_random_bytes(32),'hex'));
insert into private.gateway_key(id,key_hash) select true,encode(extensions.digest(secret,'sha256'),'hex') from gateway_fixture on conflict(id) do update set key_hash=excluded.key_hash;
do $$ begin perform set_config('request.headers','{}',true);end $$;
set local role anon;
do $$ begin begin perform public.pin_attempt_begin('+256700000099');raise exception 'Gateway secret bypass';exception when insufficient_privilege then null;end;end $$;
reset role;
do $$ begin perform set_config('request.headers',jsonb_build_object('x-yapesa-auth',(select secret from gateway_fixture))::text,true);end $$;
set local role anon;
do $$ begin
 for i in 1..5 loop perform pg_temp.check_true(public.pin_attempt_begin('+256700000099'),'initial PIN attempt allowed');end loop;
 perform pg_temp.check_true(not public.pin_attempt_begin('+256700000099'),'PIN locked after five attempts');
 perform public.pin_attempt_clear('+256700000099');
 perform pg_temp.check_true(public.pin_attempt_begin('+256700000099'),'successful login can reset the counter');
end $$;
reset role;
set constraints all immediate;
select 'secure shares SQL tests passed' as result;
rollback;
