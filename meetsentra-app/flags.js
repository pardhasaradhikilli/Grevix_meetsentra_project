// Turn on only AFTER you have run realtime_security.sql in Supabase and tested with a spare meeting.
// true  = room channels are private: the database itself refuses anyone who is not the host or an invited user.
// false = anyone who somehow learned a room code could listen in (the code is only readable by invited users).
export const PRIVATE_ROOMS = false;
