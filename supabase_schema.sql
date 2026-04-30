-- 与 migrations/ 保持同步的参考脚本（推荐 supabase_migrate.py 应用全部迁移）

create table if not exists public.profiles (
  id text primary key,
  nickname text not null default 'Player',
  "highScore" bigint not null default 0,
  "unlockedSkins" text[] not null default array['default']::text[],
  "currentSkin" text not null default 'default',
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists "unlockedSkins" text[] not null default array['default']::text[];
alter table public.profiles add column if not exists "currentSkin" text not null default 'default';
alter table public.profiles add column if not exists "highScore" bigint not null default 0;

alter table public.profiles disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.profiles to anon, authenticated;
