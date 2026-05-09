-- 007 · 好孕食谱独立数据：恢复 profiles；新建 pregnancy_user_config、pregnancy_recipes；撤销 006 遗留

drop table if exists public.recipes cascade;

alter table public.profiles drop column if exists pregnancy_status;
alter table public.profiles drop column if exists lmp_date;

create table if not exists public.pregnancy_user_config (
  user_id text primary key,
  status smallint not null default 0,
  lmp_date date
);

comment on table public.pregnancy_user_config is '好孕食谱个人配置（设备 ID）；status 0=备孕 1=怀孕';
comment on column public.pregnancy_user_config.status is '0=备孕 1=怀孕';

create table if not exists public.pregnancy_recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  cover_image text not null default '',
  cooking_time text not null default '',
  difficulty text not null default '',
  tags text[] not null default '{}',
  ingredients jsonb not null default '{}',
  steps jsonb not null default '[]',
  nutrition_insight text not null default '',
  suitable_months integer[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pregnancy_recipes is '好孕食谱：ingredients 按主料/辅料/调料；steps 含 title、content、timer、tips';
comment on column public.pregnancy_recipes.ingredients is '{"主料":[{item,amount},...],"辅料":[...],"调料":[...]}';
comment on column public.pregnancy_recipes.steps is '[{no,title,content,timer,tips},...]';
comment on column public.pregnancy_recipes.suitable_months is '0=备孕；1–10=孕月';

alter table public.pregnancy_user_config disable row level security;
alter table public.pregnancy_recipes disable row level security;

grant select, insert, update, delete on table public.pregnancy_user_config to anon, authenticated;
grant select, insert, update, delete on table public.pregnancy_recipes to anon, authenticated;

drop trigger if exists pregnancy_recipes_set_updated_at on public.pregnancy_recipes;
create trigger pregnancy_recipes_set_updated_at
  before update on public.pregnancy_recipes
  for each row execute procedure public.set_profiles_updated_at();

insert into public.pregnancy_recipes (
  title, cover_image, cooking_time, difficulty, tags,
  ingredients, steps, nutrition_insight, suitable_months
)
select
  '山药滋补红烧牛腩',
  'https://images.unsplash.com/photo-1544025162-d76694265947?w=1200&q=80',
  '约 90 分钟',
  '中等',
  array['补铁', '高蛋白', '备孕推荐', '补钙', '高钙', '预防贫血'],
  '{"主料":[{"item":"牛腩","amount":"500g"},{"item":"铁棍山药","amount":"1根"}],"辅料":[{"item":"胡萝卜","amount":"半根"},{"item":"大葱","amount":"1段"},{"item":"老姜","amount":"1块"}],"调料":[{"item":"冰糖","amount":"8颗"},{"item":"生抽","amount":"2勺"},{"item":"老抽","amount":"1勺"},{"item":"料酒","amount":"2勺"},{"item":"八角","amount":"2个"},{"item":"香叶","amount":"2片"}]}'::jsonb,
  '[
    {"no":1,"title":"浸泡","content":"牛腩切 3cm 方块，用清水浸泡 30 分钟出血水。","timer":0,"tips":""},
    {"no":2,"title":"焯水","content":"冷水下锅，加葱姜料酒，水开撇去浮沫，煮 5 分钟后捞出用温水洗净。","timer":300,"tips":"千万别用冷水冲，肉会柴。"},
    {"no":3,"title":"炒糖色","content":"小火慢炒冰糖至枣红色，下肉翻炒上色。","timer":0,"tips":""},
    {"no":4,"title":"炖煮","content":"加入所有香料和足量热水，大火烧开转小火炖 60 分钟。","timer":3600,"tips":""},
    {"no":5,"title":"焖收","content":"下入山药胡萝卜，再炖 20 分钟，最后大火收汁。","timer":1200,"tips":"收汁时再放盐，肉质更软嫩。"}
  ]'::jsonb,
  '本月重点：血红素铁与优质蛋白有助于预防孕期贫血；山药淀粉温和护胃。建议搭配一份「清炒西蓝花」和一杯橙汁（VC 辅助铁吸收）。',
  array[0, 4, 5, 6, 7, 8]
where not exists (select 1 from public.pregnancy_recipes pr where pr.title = '山药滋补红烧牛腩');
