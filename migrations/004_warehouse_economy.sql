-- 004 · 蛇币、葫芦、宝箱、地图解锁（云端 profiles）

alter table public.profiles add column if not exists coins bigint not null default 0;
alter table public.profiles add column if not exists "calabashCount" integer not null default 0;
alter table public.profiles add column if not exists crates integer not null default 0;
alter table public.profiles add column if not exists "unlockedMaps" text[]
  not null default array['classic']::text[];
alter table public.profiles add column if not exists "currentMap" text not null default 'classic';

update public.profiles set "unlockedMaps" = array['classic']::text[]
where "unlockedMaps" is null or cardinality("unlockedMaps") = 0;

update public.profiles set "currentMap" = 'classic'
where "currentMap" is null or trim("currentMap") = '';
