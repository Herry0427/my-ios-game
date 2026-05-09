-- 006 保留序号以兼容已执行过旧版 006 的数据库；好孕模块表结构见 007_pregnancy_hub_tables.sql
-- 旧 006 曾修改 profiles 并创建 public.recipes，现由 007 回滚并迁移至 pregnancy_user_config / pregnancy_recipes。
select 1;
