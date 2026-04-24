@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在从百度搜索页抓取赛程并写入 data\football_bundle.json ...
python tools\sync_football_baidu.py
if errorlevel 1 (
  echo 若提示找不到 python，请先安装 Python 3 并加入 PATH。
  pause
  exit /b 1
)
echo.
echo 自测解析器（不访问网络）:
python tools\sync_football_baidu.py --test
echo 完成。请重新部署或刷新页面以加载新数据包。
pause
