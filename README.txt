my-ios-game — PWA 街机壳 + Supabase 云端。

数据库（自动建表 / 改表，与代码联动）:
  重要：同一页 API 里有两类密钥，勿混用 ——
    · Management Token（常 sbp_...）：仅用于 python supabase_migrate.py 建表
    · anon public（常 eyJ...）：必须给 index.html / PWA 与集成测试（tests/test_supabase_profiles.py）
    只配第一种不配第二种 → 迁移成功但网页永远不会写入 profiles。
  1) 复制 supabase_local.env.example 为 supabase_local.env，填入上述两类 + 项目 ref
  2) 执行: python supabase_migrate.py
  后续表结构变更：在 migrations/ 下新增 002_xxx.sql，再运行上述命令
  AI 侧约定见仓库 .cursor/rules/ios-game-supabase-db.mdc（处理 ios_game 时会自动跟迁移同步）

自测：配置 SUPABASE_ANON_KEY 后执行 python tests/test_supabase_profiles.py（写库后自动删测试行）

一键拉取并推送：双击 run_push.bat
仅同步逻辑：sync-to-github.ps1 / push_once.ps1
