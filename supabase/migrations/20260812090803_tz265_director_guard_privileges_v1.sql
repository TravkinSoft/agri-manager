revoke execute on function public.is_current_user_director_v1() from public, anon;
grant execute on function public.is_current_user_director_v1() to authenticated;

revoke execute on function public.enforce_director_read_only_request_v1() from public, anon, authenticated;
grant execute on function public.enforce_director_read_only_request_v1() to authenticator;
