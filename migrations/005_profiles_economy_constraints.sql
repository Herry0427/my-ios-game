-- 005 · 经济字段约束与健壮性（幂等）

alter table public.profiles
  alter column coins set default 0,
  alter column "calabashCount" set default 0,
  alter column crates set default 0,
  alter column "unlockedMaps" set default array['classic']::text[],
  alter column "currentMap" set default 'classic';

update public.profiles set coins = 0 where coins < 0;
update public.profiles set "calabashCount" = 0 where "calabashCount" < 0;
update public.profiles set crates = 0 where crates < 0;
update public.profiles
set "unlockedMaps" = array['classic']::text[]
where "unlockedMaps" is null or cardinality("unlockedMaps") = 0;
update public.profiles
set "currentMap" = 'classic'
where "currentMap" is null or trim("currentMap") = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_coins_nonneg'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_coins_nonneg check (coins >= 0);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_calabash_nonneg'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_calabash_nonneg check ("calabashCount" >= 0);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_crates_nonneg'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_crates_nonneg check (crates >= 0);
  end if;
end$$;
