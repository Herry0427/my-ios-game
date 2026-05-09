-- 009 · 食谱不再使用封面图（前端已改为纯文字卡片）
alter table public.pregnancy_recipes drop column if exists cover_image;
