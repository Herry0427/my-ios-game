-- 012 · 备孕备忘清单（按设备 user_id 关联）

create table if not exists public.pregnancy_memos (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  content text not null default '',
  status smallint not null default 0,
  due_date date,
  created_at timestamptz not null default now()
);

comment on table public.pregnancy_memos is '备孕/孕期备忘待办；status 0=未处理 1=已处理';
comment on column public.pregnancy_memos.status is '0=未处理；1=已处理';

create index if not exists pregnancy_memos_user_id_created_idx
  on public.pregnancy_memos (user_id, created_at desc);

alter table public.pregnancy_memos disable row level security;

grant select, insert, update, delete on table public.pregnancy_memos to anon, authenticated;
