-- 016 · 记账簿小票（按昵称 user_id 关联，与 pregnancy_memos 一致）

create table if not exists public.receipt_days (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  day_key date not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day_key)
);

comment on table public.receipt_days is '记账簿每日小票；config 含 title/terminal/items/footer';
comment on column public.receipt_days.day_key is '记账日期 YYYY-MM-DD';
comment on column public.receipt_days.config is '小票 JSON，与前端 localStorage receipt_day_* 结构一致';

create index if not exists receipt_days_user_day_idx
  on public.receipt_days (user_id, day_key desc);

drop trigger if exists receipt_days_set_updated_at on public.receipt_days;

create trigger receipt_days_set_updated_at
  before update on public.receipt_days
  for each row execute procedure public.set_profiles_updated_at();

alter table public.receipt_days disable row level security;

grant select, insert, update, delete on table public.receipt_days to anon, authenticated;
