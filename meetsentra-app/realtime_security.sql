-- Backend-enforced access to the live room (Supabase Realtime Authorization).
-- Run this in the Supabase SQL Editor ONLY AFTER the app works, then set PRIVATE_ROOMS = true in flags.js
-- and test with a spare meeting: one invited account must still work, one NOT invited must be refused.
-- If anything breaks: set PRIVATE_ROOMS back to false (and optionally run the DROP lines at the bottom).

create policy "room members can receive"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.meetings m
    where 'room:' || m.room_code = (select realtime.topic())
      and (m.host_id = auth.uid() or public.is_invited(m.id))
  )
);

create policy "room members can send"
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.meetings m
    where 'room:' || m.room_code = (select realtime.topic())
      and (m.host_id = auth.uid() or public.is_invited(m.id))
  )
);

-- To undo:
-- drop policy "room members can receive" on realtime.messages;
-- drop policy "room members can send" on realtime.messages;
