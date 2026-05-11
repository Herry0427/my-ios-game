-- 013 · 昵称登录：按 lower(trim(nickname)) 查找已有档案，否则新建一行（家庭自用场景）

create or replace function public.login_or_register_by_nickname(p_nick text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_trim text := trim(p_nick);
  v_key text := lower(v_trim);
  v_id text;
  v_nick text;
  v_new text;
begin
  if v_key = '' then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  if length(v_trim) > 16 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;

  select p.id, p.nickname into v_id, v_nick
  from public.profiles p
  where lower(trim(p.nickname)) = v_key
  limit 1;

  if v_id is not null then
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'id', v_id,
      'nickname', v_nick
    );
  end if;

  v_new := gen_random_uuid()::text;
  insert into public.profiles (id, nickname) values (v_new, v_trim);
  return jsonb_build_object(
    'ok', true,
    'created', true,
    'id', v_new,
    'nickname', v_trim
  );
exception when unique_violation then
  select p.id, p.nickname into v_id, v_nick
  from public.profiles p
  where lower(trim(p.nickname)) = v_key
  limit 1;
  if v_id is not null then
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'id', v_id,
      'nickname', v_nick
    );
  end if;
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;

grant execute on function public.login_or_register_by_nickname(text) to anon, authenticated;
