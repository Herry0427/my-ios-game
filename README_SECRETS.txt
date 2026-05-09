Supabase 密钥放哪里（不会进 Git / GitHub）

  本目录下以下位置已写入 .gitignore，push 时不会上传：

  1) supabase_local.env
     从 supabase_local.env.example 复制，改扩展名后填值。

  2) 推荐：.secrets/supabase.env
     在 ios_game 下新建文件夹 .secrets，里面放文件 supabase.env（与 example 同键名）。
     若两个文件都存在，.secrets 里的值会覆盖 supabase_local.env 里同名的项，
     这样可以把真密钥只放在 .secrets，example 只留空壳在仓库里。

  3) 自定义路径
     设置环境变量 SUPABASE_ENV_FILE=绝对路径\某.env，会最后加载并覆盖。

  迁移与测试已统一用 supabase_env_loader.py 按上述顺序加载，无需改脚本。

  模板：见 supabase_local.env.example 与 .secrets.example/supabase.env
