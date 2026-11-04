-- Trigger records have different columns on journal and journal_line. A CASE
-- expression plans both field references, even when one branch is not selected.
create or replace function private.check_journal() returns trigger
language plpgsql set search_path='' as $$
declare target uuid; n bigint; debit numeric; credit numeric;
begin
 if tg_table_name='journal' then
   target:=new.id;
 else
   target:=new.journal_id;
 end if;
 select count(*),coalesce(sum(amount) filter(where side='debit'),0),coalesce(sum(amount) filter(where side='credit'),0)
 into n,debit,credit from public.journal_line where journal_id=target;
 if n<2 or debit<>credit then raise exception 'Journal must balance' using errcode='23514'; end if;
 return null;
end $$;
