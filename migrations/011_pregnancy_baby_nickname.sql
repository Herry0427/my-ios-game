-- 011 · pregnancy_user_config：宝宝乳名（可选）

alter table public.pregnancy_user_config add column if not exists baby_nickname text;

comment on column public.pregnancy_user_config.baby_nickname is '宝宝乳名（可选），用于状态卡标题展示';
