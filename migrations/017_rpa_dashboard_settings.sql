-- 017 · RPA 仪表盘地址跨设备保存（独立于账单和其他业务数据）
-- 昵称登录不构成安全认证；dashboard_url 可能包含 token，请勿将此表视为私密存储。

create table if not exists public.rpa_dashboard_settings (
  user_id text primary key,
  dashboard_url text,
  updated_at timestamptz not null default now()
);

comment on table public.rpa_dashboard_settings is '按昵称登录返回的 user_id 保存 RPA 仪表盘地址；昵称登录并非安全认证';
comment on column public.rpa_dashboard_settings.dashboard_url is '仪表盘 URL 可能包含 token，请避免存储敏感凭据';

drop trigger if exists rpa_dashboard_settings_set_updated_at on public.rpa_dashboard_settings;

create trigger rpa_dashboard_settings_set_updated_at
  before update on public.rpa_dashboard_settings
  for each row execute procedure public.set_profiles_updated_at();

alter table public.rpa_dashboard_settings disable row level security;

grant select, insert, update, delete on table public.rpa_dashboard_settings to anon, authenticated;
