-- 008 · 好孕食谱：5 道高精度菜谱（ingredients 主料/辅料/调料；steps 含 timer、tips）

insert into public.pregnancy_recipes (
  title, cover_image, cooking_time, difficulty, tags,
  ingredients, steps, nutrition_insight, suitable_months
)
select
  '西红柿山药牛腩',
  '',
  '约 95 分钟',
  '中等',
  array['高效补铁', '预防贫血', '宝宝发育'],
  $ing$
{"主料":[{"item":"牛腩","amount":"500g"},{"item":"铁棍山药","amount":"1根"}],"辅料":[{"item":"熟透的大番茄","amount":"3个"},{"item":"洋葱","amount":"1/4个"}],"调料":[{"item":"冰糖","amount":"8颗"},{"item":"老姜/大葱","amount":"适量"},{"item":"陈醋","amount":"1勺"}]}
$ing$::jsonb,
  $st$
[
  {"no":1,"title":"去腥","content":"牛腩切 3cm 方块，冷水入锅，加葱姜料酒，水开后撇去浮沫煮 5 分钟，捞出务必用【温水】洗净。","timer":300,"tips":""},
  {"no":2,"title":"炒汁","content":"热锅凉油，下洋葱碎和一半番茄丁炒至软烂出沙（这是汤浓的关键）。","timer":0,"tips":""},
  {"no":3,"title":"焖炖","content":"倒入牛腩，加一勺陈醋（促使肉质纤维软化），加满热水，小火压焖 60 分钟。","timer":3600,"tips":""},
  {"no":4,"title":"合炖","content":"加入山药段和剩下的一半番茄块，继续炖 20 分钟。","timer":1200,"tips":"番茄分两次放，一次熬汁，一次吃块，口感层次最丰富。"}
]
$st$::jsonb,
  '搭配「清炒西蓝花」，VC 能够将牛肉中铁的吸收率显著提高。',
  array[0, 4, 5, 6, 7]
where not exists (select 1 from public.pregnancy_recipes r where r.title = '西红柿山药牛腩');

insert into public.pregnancy_recipes (
  title, cover_image, cooking_time, difficulty, tags,
  ingredients, steps, nutrition_insight, suitable_months
)
select
  '金汤柠檬鲈鱼',
  '',
  '约 25 分钟',
  '中等',
  array['补DHA', '开胃缓解孕吐', '高蛋白'],
  $ing$
{"主料":[{"item":"鲜活鲈鱼","amount":"1条"}],"辅料":[{"item":"黄柠檬","amount":"半个"},{"item":"金针菇","amount":"1把"}],"调料":[{"item":"蒸鱼豉油","amount":"2勺"},{"item":"白胡椒粉","amount":"微量"}]}
$ing$::jsonb,
  $st$
[
  {"no":1,"title":"腌制","content":"鱼背划深刀，抹少许盐和白胡椒腌制 10 分钟。柠檬切薄片去籽（必须去籽，否则发苦）。","timer":600,"tips":""},
  {"no":2,"title":"铺底","content":"盘底铺金针菇和姜片，鱼摆在上面，鱼身上盖两片柠檬。","timer":0,"tips":""},
  {"no":3,"title":"强火蒸","content":"水开后上锅，大火计时蒸 8 分钟，立刻关火。","timer":480,"tips":"一定要水开后再放鱼，蒸的时间千万别超 8 分钟，否则鱼肉就不嫩了。"},
  {"no":4,"title":"泼油","content":"倒掉盘中多余的腥水（重要！），淋上豉油，泼上一勺热的花生油。","timer":0,"tips":""}
]
$st$::jsonb,
  '搭配一碗「五谷米饭」，提供优质碳水。',
  array[1, 2, 3]
where not exists (select 1 from public.pregnancy_recipes r where r.title = '金汤柠檬鲈鱼');

insert into public.pregnancy_recipes (
  title, cover_image, cooking_time, difficulty, tags,
  ingredients, steps, nutrition_insight, suitable_months
)
select
  '坚果腰果虾仁',
  '',
  '约 15 分钟',
  '中等',
  array['宝宝智力发育', '补钙', '不长胖'],
  $ing$
{"主料":[{"item":"大虾仁","amount":"200g"},{"item":"原味腰果","amount":"50g"}],"辅料":[{"item":"荷兰豆/胡萝卜片","amount":"50g"}],"调料":[{"item":"大蒜","amount":"3瓣"},{"item":"淀粉","amount":"1勺"}]}
$ing$::jsonb,
  $st$
[
  {"no":1,"title":"上浆","content":"虾仁开背去虾线，用厨房纸吸干水分，加半勺淀粉和一点油抓匀腌制。","timer":0,"tips":""},
  {"no":2,"title":"复脆","content":"冷油下腰果，小火炸至微黄立刻捞出冷却（余温会让它更脆）。","timer":60,"tips":""},
  {"no":3,"title":"快炒","content":"高火快炒虾仁 1 分钟至变色，下入焯过水的荷兰豆和胡萝卜片。","timer":60,"tips":""},
  {"no":4,"title":"合炒","content":"出锅前 10 秒撒入腰果，快速翻匀关火。","timer":0,"tips":"腰果一定要最后放，在锅里待久了会回软，失去酥脆感。"}
]
$st$::jsonb,
  '搭配「芝麻拌菠菜」，强化矿物质摄入。',
  array[4, 5, 6, 7]
where not exists (select 1 from public.pregnancy_recipes r where r.title = '坚果腰果虾仁');

insert into public.pregnancy_recipes (
  title, cover_image, cooking_time, difficulty, tags,
  ingredients, steps, nutrition_insight, suitable_months
)
select
  '腐竹黑木耳烧肉',
  '',
  '约 25 分钟（不含泡发）',
  '中等',
  array['预防便秘', '补血', '优质蛋白'],
  $ing$
{"主料":[{"item":"黑猪里脊肉","amount":"200g"}],"辅料":[{"item":"干腐竹","amount":"2支"},{"item":"干黑木耳","amount":"1小把"}],"调料":[{"item":"生抽","amount":"1勺"},{"item":"蚝油","amount":"半勺"}]}
$ing$::jsonb,
  $st$
[
  {"no":1,"title":"泡发","content":"腐竹和木耳提前用冷水泡发 2 小时，切成小段。","timer":0,"tips":""},
  {"no":2,"title":"滑肉","content":"肉丝加生抽腌制后，下锅滑散至变色立刻盛出。","timer":0,"tips":""},
  {"no":3,"title":"焖烧","content":"锅底留油炒木耳腐竹，加半碗水盖盖焖煮 3 分钟，让腐竹吸饱汤汁。","timer":180,"tips":""},
  {"no":4,"title":"收尾","content":"倒入肉丝，加蚝油大火翻炒至汤汁浓稠即可。","timer":0,"tips":"木耳下锅前一定要沥干水，否则炒的时候容易「炸锅」溅油。"}
]
$st$::jsonb,
  '搭配「紫菜蛋花汤」，增加碘摄入。',
  array[4, 5, 6, 7, 8, 9, 10]
where not exists (select 1 from public.pregnancy_recipes r where r.title = '腐竹黑木耳烧肉');

insert into public.pregnancy_recipes (
  title, cover_image, cooking_time, difficulty, tags,
  ingredients, steps, nutrition_insight, suitable_months
)
select
  '板栗红枣炖乌鸡',
  '',
  '约 70 分钟',
  '中等',
  array['气血调理', '叶酸补充', '暖宫滋补'],
  $ing$
{"主料":[{"item":"乌鸡","amount":"半只"},{"item":"剥壳板栗","amount":"10-12颗"}],"辅料":[{"item":"红枣","amount":"5颗"},{"item":"枸杞","amount":"1小撮"}],"调料":[{"item":"姜片","amount":"3片"},{"item":"盐","amount":"少许"}]}
$ing$::jsonb,
  $st$
[
  {"no":1,"title":"洗浴","content":"乌鸡切块，反复冷水浸泡洗净血水。","timer":0,"tips":""},
  {"no":2,"title":"入罐","content":"乌鸡、姜片、红枣放入砂锅，一次性加足热水（水量没过鸡肉 3-5 厘米）。","timer":0,"tips":""},
  {"no":3,"title":"慢炖","content":"大火烧开撇沫，转最小火慢炖 45 分钟。","timer":2700,"tips":""},
  {"no":4,"title":"收官","content":"加入板栗和枸杞，继续小火炖 20 分钟，最后撒极少量的盐。","timer":1200,"tips":"好的乌鸡汤不需要放任何调料。盐一定要最后放，否则鸡肉蛋白会收缩，汤不鲜。"}
]
$st$::jsonb,
  '搭配「全麦馒头」；板栗本身是优质淀粉，主食可减半。',
  array[0, 8, 9, 10]
where not exists (select 1 from public.pregnancy_recipes r where r.title = '板栗红枣炖乌鸡');
