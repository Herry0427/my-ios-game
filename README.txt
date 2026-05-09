my-ios-game — PWA 街机壳 + Supabase 云端。

数据库（自动建表 / 改表，与代码联动）:
  重要：同一页 API 里有两类密钥，勿混用 ——
    · Management Token（常 sbp_...）：仅用于 python supabase_migrate.py 建表
    · anon public（常 eyJ...）：必须给 index.html / PWA 与集成测试（tests/test_supabase_profiles.py）
    只配第一种不配第二种 → 迁移成功但网页永远不会写入 profiles。
  1) 密钥仅放本机：复制 supabase_local.env.example 为 supabase_local.env，或见 README_SECRETS.txt 使用 .secrets/supabase.env（均 gitignore）
  2) 执行: python supabase_migrate.py
  后续表结构变更：在 migrations/ 下新增 002_xxx.sql，再运行上述命令
  AI 侧约定见仓库 .cursor/rules/ios-game-supabase-db.mdc（处理 ios_game 时会自动跟迁移同步）

自测：配置 SUPABASE_ANON_KEY 后执行 python tests/test_supabase_profiles.py（写库后自动删测试行）

贪吃蛇皮肤：profiles.unlockedSkins（text[]）、currentSkin；阈值 27/96/168/222/328；迁移见 migrations/002_*.sql（RLS 已关闭）

好孕食谱：pregnancy_user_config、pregnancy_recipes（007）；种子「山药滋补红烧牛腩」；首页「好孕食谱」。006 为序号占位；勿再往 profiles 写孕期字段。

云端首次建表 / 增量迁移：填好 supabase_local.env 后双击 after_env_fill_run.bat，或见 MIGRATE_ONE_STEP.txt。

一键拉取并推送：双击 run_push.bat
仅同步逻辑：sync-to-github.ps1 / push_once.ps1
