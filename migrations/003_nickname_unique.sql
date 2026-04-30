-- 昵称唯一：lower(trim(nickname)) 全局唯一（含空串仅允许一行，建议客户端不写空昵称）

create unique index if not exists profiles_nickname_lower_unique
  on public.profiles (lower(trim(nickname)));

-- 查重：除当前 userId 外是否已有同昵称（大小写不敏感、trim）
create or replace function public.is_nickname_available(p_nick text, p_uid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.profiles p
    where trim(p_nick) <> ''
      and lower(trim(p.nickname)) = lower(trim(p_nick))
      and p.id is distinct from p_uid
  );
$$;

grant execute on function public.is_nickname_available(text, text) to anon, authenticated;
