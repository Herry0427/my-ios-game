-- 015 · pregnancy_memos.updated_at：切换状态时刷新，供 48h 自动保洁

alter table public.pregnancy_memos
  add column if not exists updated_at timestamptz;

update public.pregnancy_memos
set updated_at = coalesce(created_at, now())
where updated_at is null;

alter table public.pregnancy_memos
  alter column updated_at set default now();

alter table public.pregnancy_memos
  alter column updated_at set not null;

drop trigger if exists pregnancy_memos_set_updated_at on public.pregnancy_memos;

create trigger pregnancy_memos_set_updated_at
  before update on public.pregnancy_memos
  for each row execute procedure public.set_profiles_updated_at();

comment on column public.pregnancy_memos.updated_at is '行更新时间；完成态保洁以本字段为准（切换 status 时自动刷新）';
