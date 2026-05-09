@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 1. Supabase 迁移（需 supabase_local.env 或 .secrets/supabase.env，见 README_SECRETS.txt）===
python supabase_migrate.py
if errorlevel 1 (
  echo 迁移失败：请检查密钥文件中的 SUPABASE_MANAGEMENT_TOKEN 与 SUPABASE_PROJECT_REF
  pause
  exit /b 1
)
echo.
echo === 2. 集成测试 profiles + pregnancy_hub（需 SUPABASE_ANON_KEY）===
python tests\test_supabase_profiles.py
echo.
echo === 3. 孕周逻辑自测（无需密钥）===
python tests\test_pregnancy_logic.py
echo.
pause
