-- ios_game · 002 — 皮肤解锁字段、bigint 分数、关闭 RLS（自用小游戏通畅优先）

-- 新列（已有表则追加）
alter table public.profiles add column if not exists "unlockedSkins" text[]
  not null default array['default']::text[];
alter table public.profiles add column if not exists "currentSkin" text
  not null default 'default';

-- 历史高分改为 int8
alter table public.profiles
  alter column "highScore" type bigint using "highScore"::bigint;

-- 旧行补齐（若先前无默认值）
update public.profiles
set "unlockedSkins" = array['default']::text[]
where "unlockedSkins" is null;

update public.profiles
set "currentSkin" = 'default'
where "currentSkin" is null or trim("currentSkin") = '';

-- 关闭 RLS，依赖 GRANT 控制（策略全部删除以免歧义）
alter table public.profiles disable row level security;

drop policy if exists "profiles_public_select" on public.profiles;
drop policy if exists "profiles_public_insert" on public.profiles;
drop policy if exists "profiles_public_update" on public.profiles;
drop policy if exists "profiles_public_delete" on public.profiles;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.profiles to anon, authenticated;
