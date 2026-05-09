-- 010 · 孕育百科（按 suitable_months 与当前孕月/备孕匹配）

create table if not exists public.pregnancy_knowledge (
  id uuid primary key default gen_random_uuid(),
  category text,
  content text not null,
  suitable_months int4[] not null default '{}'
);

comment on table public.pregnancy_knowledge is '孕育百科贴士；suitable_months 含 0 表示全阶段通用';
comment on column public.pregnancy_knowledge.category is '分类：冷知识、饮食、护理、心理、禁忌等';
comment on column public.pregnancy_knowledge.suitable_months is '适用月份，0=备孕/通用，1–10=孕月';

alter table public.pregnancy_knowledge disable row level security;

grant select on table public.pregnancy_knowledge to anon, authenticated;

insert into public.pregnancy_knowledge (category, content, suitable_months)
select t.category, t.content, t.suitable_months
from (
  values
    ('冷知识', '羊水其实是「尿液」：怀孕4个月后，宝宝就开始排尿了，这对肺部发育至关重要。', ARRAY[0,4,5,6]::int4[]),
    ('冷知识', '指纹在孕期形成：宝宝的指纹在怀孕第13周左右就已经形成了，且终生不变。', ARRAY[0,4]::int4[]),
    ('心理', '准爸爸也有「妊娠反应」：由于紧张和焦虑，准爸爸也可能出现恶心、食欲差，医学称「妊娠伴随综合征」。', ARRAY[0]::int4[]),
    ('饮食', '缓解孕吐：建议少量多餐，早起先吃一点苏打饼干或吐司，避免胃部排空。', ARRAY[1,2,3]::int4[]),
    ('禁忌', '水果避雷：患有妊娠期糖尿病的准妈妈应慎食香蕉，其含糖量高且含有几丁质酶过敏原。', ARRAY[0]::int4[]),
    ('护理', '避免毒素接触：尽量避免使用含有BPA（双酚A）的塑料容器，护肤品建议选用天然成分。', ARRAY[0]::int4[]),
    ('发育', '听力觉醒：第20周左右，宝宝开始能听到妈妈的心跳和外界的声音了，可以多和TA说话。', ARRAY[5,6]::int4[]),
    ('饮食', '补铁秘诀：吃牛肉、猪肝等红肉时，搭配富含VC的橙子或西蓝花，吸收率能提高3-5倍。', ARRAY[0,4,5,6,7]::int4[]),
    ('冷知识', '妈妈的心脏会变大：为了给宝宝输送更多血液，孕妈的心脏体积会略微增大，心率也会加快。', ARRAY[0,4,5,6]::int4[]),
    ('护理', '数胎动：进入第28周后，建议每天固定时间数胎动，这是监测宝宝健康的「晴雨表」。', ARRAY[7,8,9]::int4[])
) as t(category, content, suitable_months)
where not exists (select 1 from public.pregnancy_knowledge limit 1);
