/**
 * 足球赛程：可选「远程实时包」地址（须 HTTPS，且接口返回与 data/football_bundle.json 相同 JSON 结构）。
 * 部署：双击 serverless/deploy_worker.bat（内部用 PowerShell 显示 UTF-8 中文）。说明见 DEPLOY_WORKER_HELP.txt、NO_NODE_DASHBOARD_DEPLOY.txt。
 * 已对接当前 Cloudflare Worker（可按需改回空字符串仅用本地 data 包）。
 */
window.__IOS_GAME_FOOTBALL_REMOTE__ =
  "https://ios-game-football.ios-game.workers.dev/football-bundle.json";
