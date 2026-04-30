-- ios_game · 001 — profiles 表、RLS、触发器（幂等 + 结构修复）
-- 由 supabase_migrate.py 经 Management API 应用；后续增量请新增 002_*.sql

-- 表（新建库）
create table if not exists public.profiles (
  id text primary key,
  nickname text not null default 'Player',
  "highScore" integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 旧表缺列时补齐（不改已有列类型）
alter table public.profiles add column if not exists nickname text not null default 'Player';
alter table public.profiles add column if not exists "highScore" integer not null default 0;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

comment on table public.profiles is '街机大厅玩家档案（贪吃蛇最高分等）';

-- API 角色（Supabase PostgREST / anon key）
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.profiles to anon, authenticated;

alter table public.profiles enable row level security;

drop policy if exists "profiles_public_select" on public.profiles;
drop policy if exists "profiles_public_insert" on public.profiles;
drop policy if exists "profiles_public_update" on public.profiles;
drop policy if exists "profiles_public_delete" on public.profiles;

create policy "profiles_public_select"
  on public.profiles for select
  using (true);

create policy "profiles_public_insert"
  on public.profiles for insert
  with check (true);

create policy "profiles_public_update"
  on public.profiles for update
  using (true)
  with check (true);

create policy "profiles_public_delete"
  on public.profiles for delete
  using (true);

create or replace function public.set_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_profiles_updated_at();
