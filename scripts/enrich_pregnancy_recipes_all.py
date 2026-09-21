#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量细化 pregnancy_recipes：统一步骤字段（title/content/tips/timer），
并按菜型扩充可操作描述；对已较详细的菜谱做「轻量增强」，对简略菜谱做「模板重写」。

用法（在 ios_game 目录）:
  python scripts/enrich_pregnancy_recipes_all.py --dry-run
  python scripts/enrich_pregnancy_recipes_all.py
  python scripts/enrich_pregnancy_recipes_all.py --limit 20   # 仅处理前 N 条（调试用）

依赖：SUPABASE_URL、SUPABASE_ANON_KEY（supabase_local.env / .secrets/supabase.env）
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from supabase_env_loader import load_supabase_env

# --- 与 seed 脚本一致，用于识别种子荤菜标题结构 ---
MEAT_CORE = (
    "鸡腿丁",
    "鸡胸片",
    "猪里脊丝",
    "梅花肉片",
    "牛腩块",
    "排骨段",
    "鲈鱼块",
    "带鱼段",
    "鲜虾仁",
    "鱿鱼卷",
    "鸭胸片",
    "羊肉片",
)
VEG_PREFIX = (
    "清炒",
    "蒜蓉",
    "白灼",
    "凉拌",
    "蚝油",
    "上汤",
    "椒盐",
    "醋溜",
    "葱油",
    "干煸",
)


def http_json(method: str, url: str, headers: dict, body=None) -> tuple[int, object]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=data, method=method, headers=headers)
    with urlopen(req, timeout=120) as resp:
        code = resp.getcode()
        raw = resp.read().decode("utf-8", errors="replace").strip()
        if not raw:
            return code, None
        return code, json.loads(raw)


def fetch_all_recipes(base: str, anon: str) -> list[dict]:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
    }
    rows: list[dict] = []
    offset = 0
    page = 200
    while True:
        url = (
            f"{base}/rest/v1/pregnancy_recipes"
            f"?select=*&limit={page}&offset={offset}"
        )
        code, data = http_json("GET", url, headers)
        if code != 200 or not isinstance(data, list):
            raise RuntimeError(f"GET recipes failed: {code} {data}")
        rows.extend(data)
        if len(data) < page:
            break
        offset += page
    return rows


def strip_suffix(title: str) -> str:
    return re.sub(r"（[^）]{1,32}）\s*$", "", title.strip())


def step_text(s: dict) -> str:
    return (s.get("content") or s.get("desc") or "").strip()


def normalize_step(s: dict, idx: int) -> dict:
    """统一为 no/title/content/timer/tips。"""
    no = s.get("no")
    if no is None:
        no = idx + 1
    content = (s.get("content") or s.get("desc") or "").strip()
    title = (s.get("title") or "").strip()
    if not title and content:
        title = content.split("：")[0][:18] if "：" in content[:24] else content[:10]
    tips = (s.get("tips") or "").strip()
    timer = s.get("timer")
    try:
        timer_i = int(timer) if timer is not None and str(timer).strip() != "" else 0
    except (TypeError, ValueError):
        timer_i = 0
    return {
        "no": int(no),
        "title": title or f"步骤{no}",
        "content": content,
        "timer": timer_i,
        "tips": tips,
    }


def normalize_steps(steps: Any) -> list[dict]:
    if not isinstance(steps, list):
        return []
    out = []
    for i, s in enumerate(steps):
        if not isinstance(s, dict):
            continue
        out.append(normalize_step(s, i))
    out.sort(key=lambda x: x["no"])
    return out


def detail_score(steps: list[dict]) -> float:
    if not steps:
        return 0.0
    texts = [step_text(s) for s in steps]
    avg = sum(len(t) for t in texts) / max(len(texts), 1)
    tips_n = sum(1 for s in steps if (s.get("tips") or "").strip())
    return len(steps) * 40 + avg + tips_n * 30


def needs_heavy_rewrite(title: str, steps_norm: list[dict], score: float) -> bool:
    """判定是否用菜型模板整体重写（种子简略菜谱）。"""
    t = strip_suffix(title)
    if score >= 220 and len(steps_norm) >= 5:
        return False
    if score >= 180 and len(steps_norm) >= 4 and any(len(step_text(s)) > 95 for s in steps_norm):
        return False
    # 种子荤：X烧Y
    if "烧" in t and any(c in t for c in MEAT_CORE):
        return True
    # 种子素
    for vp in VEG_PREFIX:
        if t.startswith(vp) and len(t) > len(vp) + 1:
            return True
    if len(steps_norm) <= 3:
        return True
    if score < 130:
        return True
    return False


def ing_text(ing: dict) -> str:
    if not isinstance(ing, dict):
        return ""
    parts = ing.get("主料") or []
    sec = ing.get("辅料") or []
    tio = ing.get("调料") or []
    buf = []
    for x in parts + sec + tio:
        if isinstance(x, dict):
            buf.append(f'{x.get("item","")}{x.get("amount","")}')
    return " ".join(buf)


# ---------- 迁移菜谱 + 泰式虾：手工细化版 ----------

def steps_shanyao_brisket(_ing: dict) -> list[dict]:
    return [
        {
            "no": 1,
            "title": "浸泡去血水",
            "content": "牛腩切约 3cm 方块，清水浸泡 30 分钟，中途可换水 1 次，去除血水与杂质，沥干备用。",
            "timer": 1800,
            "tips": "浸泡充分可减少焯水时浮沫与腥味。",
        },
        {
            "no": 2,
            "title": "焯水洗净",
            "content": "冷水下锅，加葱段、姜片、料酒；煮沸后撇净浮沫，保持小火再煮约 5 分钟，捞出牛腩用【温水】冲洗沥干。",
            "timer": 300,
            "tips": "切忌用冷水冲热肉，蛋白质骤缩易柴；温水冲洗更利于后续炖烂。",
        },
        {
            "no": 3,
            "title": "炒糖色上色",
            "content": "小火少油下冰糖慢慢炒至枣红色气泡细密，立即下牛腩大火翻炒至上色均匀，注意勿炒糊。",
            "timer": 180,
            "tips": "糖色宜小火耐心推；孕妇饮食若控糖，可减少冰糖或省略糖色改老抽上色。",
        },
        {
            "no": 4,
            "title": "香料焖炖",
            "content": "加入八角、香叶、生抽、老抽、料酒与足量热水（一次性加够），大火烧开转小火加盖炖约 60 分钟至牛腩八九分软。",
            "timer": 3600,
            "tips": "热水一次性加足，中途少开盖；汤汁略咸利于入味，收汁前再微调盐。",
        },
        {
            "no": 5,
            "title": "合入山药胡萝卜",
            "content": "山药去皮切滚刀块（戴手套防痒），胡萝卜切滚刀块；下入锅中翻匀，小火续炖约 20 分钟至山药软糯。",
            "timer": 1200,
            "tips": "山药易碎，翻动宜轻；孕吐期可将山药切稍小更易消化。",
        },
        {
            "no": 6,
            "title": "收汁调味出锅",
            "content": "转中火收汁至汤汁挂勺，此时再加少量盐调味；装盘后可撒葱花点缀，趁热食用。",
            "timer": 300,
            "tips": "盐宜最后放，避免肉质过早收缩；搭配一份深色蔬菜与富含维生素 C 的水果助铁吸收。",
        },
    ]


def steps_tomato_beef_brisket(_ing: dict) -> list[dict]:
    return [
        {
            "no": 1,
            "title": "牛腩焯水去腥",
            "content": "牛腩切 3cm 块，冷水入锅加葱姜料酒，煮沸撇沫后再煮约 5 分钟，捞出务必用【温水】冲洗沥干。",
            "timer": 300,
            "tips": "温水冲洗可减少肉质变柴；浮沫撇净汤更清。",
        },
        {
            "no": 2,
            "title": "番茄洋葱炒出沙",
            "content": "热锅凉油，下洋葱碎与一半番茄丁中火炒至软烂出汁（汤色浓郁的关键），可轻压番茄帮助出沙。",
            "timer": 240,
            "tips": "番茄建议选熟透品种；可分两次投放番茄，一次熬汁、一次保留块状口感。",
        },
        {
            "no": 3,
            "title": "下牛腩加醋焖炖",
            "content": "倒入牛腩翻炒，加入一勺陈醋（有助于肉质纤维软化），注入足量热水没过食材，大火烧开转小火压焖或砂锅焖约 60 分钟。",
            "timer": 3600,
            "tips": "孕期胃酸过多者可减少醋量或省略；焖煮保持微沸即可。",
        },
        {
            "no": 4,
            "title": "山药与余下番茄同炖",
            "content": "加入铁棍山药段与剩余番茄块，翻匀后继续小火炖约 20 分钟，至山药用筷子可轻松戳透。",
            "timer": 1200,
            "tips": "山药不宜过早下锅以免炖散；番茄第二次入锅保留酸甜块状层次。",
        },
        {
            "no": 5,
            "title": "调味收汁装盘",
            "content": "尝味后补少量盐或黑胡椒；汤汁偏多可中火略收汁；盛出搭配杂粮饭或全麦主食。",
            "timer": 180,
            "tips": "搭配一份焯拌西兰花或甜椒，维生素 C 有助于提高牛肉铁吸收率。",
        },
    ]


def steps_lemon_bass(_ing: dict) -> list[dict]:
    return [
        {
            "no": 1,
            "title": "鱼身处理与腌制",
            "content": "鲈鱼去鳞去内脏洗净，鱼背划深刀便于熟透；抹少量盐与白胡椒粉腌制 10 分钟。柠檬切薄片并仔细去籽。",
            "timer": 600,
            "tips": "柠檬籽务必去净，否则蒸后汁液易发苦。",
        },
        {
            "no": 2,
            "title": "铺底摆盘",
            "content": "盘底铺金针菇与姜片，鱼架其上，鱼身放两片柠檬；可按喜好点缀葱白丝。",
            "timer": 0,
            "tips": "金针菇提前焯水挤干可减少蒸后汤水过多。",
        },
        {
            "no": 3,
            "title": "旺火蒸制",
            "content": "蒸锅水【沸腾】后再放入鱼盘，大火蒸约 8 分钟立即关火，利用余温再焖 1 分钟开盖。",
            "timer": 480,
            "tips": "冷水上锅易蒸老；总时长不宜超过 9 分钟，鱼肉才细嫩。",
        },
        {
            "no": 4,
            "title": "沥汁淋油",
            "content": "倒掉盘中腥水（重要），淋蒸鱼豉油；另烧热少量花生油至微微冒烟，泼在鱼身与葱丝上激香。",
            "timer": 60,
            "tips": "泼油量少而热即可，孕期饮食宜控制总油量。",
        },
        {
            "no": 5,
            "title": "上桌搭配",
            "content": "可挤少许新鲜柠檬汁增香；配一碗杂粮饭与一份焯水蔬菜均衡一餐。",
            "timer": 0,
            "tips": "DHA 与优质蛋白对胎儿发育有益；对鱼类过敏者遵医嘱替换蛋白来源。",
        },
    ]


def steps_cashew_shrimp(_ing: dict) -> list[dict]:
    return [
        {
            "no": 1,
            "title": "虾仁上浆",
            "content": "虾仁开背去虾线，厨房纸吸干水分；加少许盐、半勺淀粉与几滴油抓匀腌 10 分钟，口感更弹。",
            "timer": 600,
            "tips": "水分吸干再上浆，炒制时才不易脱浆出水。",
        },
        {
            "no": 2,
            "title": "腰果复脆",
            "content": "冷油下腰果，小火慢炸至浅金黄色立即捞出沥油摊凉（余温会继续上色）。",
            "timer": 120,
            "tips": "腰果颜色宁浅勿深，避免焦糊发苦；可用烤箱少油烘烤代替油炸。",
        },
        {
            "no": 3,
            "title": "配菜预处理",
            "content": "荷兰豆撕筋，胡萝卜切菱形片；沸水加少许油盐焯烫 30–40 秒捞出过凉水保持翠绿色。",
            "timer": 90,
            "tips": "焯水时间短，保持爽脆口感与色泽。",
        },
        {
            "no": 4,
            "title": "高火快炒虾仁",
            "content": "热锅少油大火，下虾仁快速翻炒约 1 分钟至变色卷曲，倒入配菜翻炒均匀。",
            "timer": 90,
            "tips": "虾仁忌久炒，肉质变老；全程大火快炒锁汁。",
        },
        {
            "no": 5,
            "title": "合入腰果出锅",
            "content": "出锅前约 10 秒撒入腰果快速翻匀即关火装盘；可按口味勾薄芡或淋少许蚝油。",
            "timer": 15,
            "tips": "腰果必须最后放，久炒会回软失去酥脆。",
        },
    ]


def steps_tofu_pork(_ing: dict) -> list[dict]:
    return [
        {
            "no": 1,
            "title": "干货泡发",
            "content": "腐竹与木耳冷水泡发约 2 小时至无硬芯；腐竹切段，木耳撕小朵并彻底沥干。",
            "timer": 0,
            "tips": "木耳务必沥干再炒，避免热油溅烫；泡发时间过长易软烂。",
        },
        {
            "no": 2,
            "title": "肉丝腌制滑炒",
            "content": "里脊切丝，加生抽与少量淀粉抓匀；热锅冷油滑散至变色立刻盛出，保持嫩滑。",
            "timer": 120,
            "tips": "滑炒油温不宜过高，肉丝八成熟即可盛出备用。",
        },
        {
            "no": 3,
            "title": "焖煮腐竹木耳",
            "content": "锅底留底油炒香木耳与腐竹，加半碗清水盖盖小火焖约 3 分钟，让腐竹吸饱汤汁。",
            "timer": 180,
            "tips": "焖煮补水利腐竹入味；注意火候避免粘锅。",
        },
        {
            "no": 4,
            "title": "合炒收汁",
            "content": "倒回肉丝，加蚝油大火翻炒至汤汁挂勺；尝味补盐，出锅撒葱花。",
            "timer": 120,
            "tips": "孕期控盐可用香菇粉或少量蚝油替代部分盐。",
        },
        {
            "no": 5,
            "title": "营养搭配建议",
            "content": "配一份紫菜蛋花汤补碘，再加一份凉拌菠菜补叶酸与矿物质更均衡。",
            "timer": 0,
            "tips": "木耳膳食纤维高，肠胃不适时可减少用量。",
        },
    ]


def steps_chicken_stew(_ing: dict) -> list[dict]:
    return [
        {
            "no": 1,
            "title": "乌鸡清洗浸泡",
            "content": "乌鸡剁块，流水冲洗后冷水浸泡 20–30 分钟去血水，捞出沥干。",
            "timer": 1200,
            "tips": "血水去净汤更清；鸡皮可按个人喜好去除部分脂肪。",
        },
        {
            "no": 2,
            "title": "砂锅一次加足热水",
            "content": "乌鸡与姜片、红枣入砂锅，一次性注入足量热水，水面高出食材约 3–5cm，大火烧开撇沫。",
            "timer": 300,
            "tips": "中途尽量少加水；撇沫后汤色更清亮。",
        },
        {
            "no": 3,
            "title": "小火慢炖出鲜",
            "content": "转小火加盖慢炖约 45 分钟，保持汤面微微翻滚即可。",
            "timer": 2700,
            "tips": "小火慢炖释放鲜味；勿大火久沸导致汤色浑浊。",
        },
        {
            "no": 4,
            "title": "下板栗枸杞收尾",
            "content": "加入剥壳板栗继续小火炖约 20 分钟至软糯；起锅前 5 分钟下枸杞，极少盐调味即可。",
            "timer": 1200,
            "tips": "盐最后放，避免蛋白质过早收缩；枸杞不宜久煮以免营养流失与烂糊。",
        },
        {
            "no": 5,
            "title": "主食与份量提示",
            "content": "板栗含淀粉，当日主食可适当减量；搭配全麦馒头与焯水青菜更均衡。",
            "timer": 0,
            "tips": "尿酸偏高或医嘱限嘌呤者应咨询医生是否适合大量饮用浓鸡汤。",
        },
    ]


def steps_thai_lime_shrimp(ing: dict) -> list[dict]:
    amt = "约 500g（基围虾或青虾，带壳称重）"
    parts = ing.get("主料") if isinstance(ing, dict) else []
    if isinstance(parts, list) and parts:
        amt = parts[0].get("amount") or amt
    return [
        {
            "no": 1,
            "title": "处理虾仁",
            "content": f"鲜虾去头去壳挑净虾线；背部轻划一刀（开背）更易入味、造型更立体。主料参考用量：{amt}。洋葱切细丝，小番茄对半切，香菜切段，小米辣与蒜切末。",
            "timer": 900,
            "tips": "开背可选；虾仁务必沥干再焯烫，避免水分过多稀释酱汁。",
        },
        {
            "no": 2,
            "title": "沸水焯烫",
            "content": "锅中烧水，加入姜片与料酒；水沸腾后下虾仁，煮至变红卷曲约 1 分钟立即捞出，切勿久煮。",
            "timer": 60,
            "tips": "沸水入锅、时间短，虾肉才弹嫩；久煮易老。",
        },
        {
            "no": 3,
            "title": "冰水锁脆",
            "content": "捞出虾仁立刻投入冰水浸泡 3–5 分钟，沥干备用；此举让肉质收紧、口感更 Q 弹。",
            "timer": 240,
            "tips": "冰水为可饮用冷水加冰块；孕期确保冰块与容器洁净。",
        },
        {
            "no": 4,
            "title": "调制泰式酱汁",
            "content": "小碗放蒜末、小米辣碎；可选淋入一勺热油激发香味。加入鱼露 2–3 勺、青柠檬汁、白糖或椰糖 1 勺、少量生抽或蚝油，搅拌至糖完全融化；喜果香可加入百香果肉。薄荷叶、香茅、南姜可按喜好点缀。",
            "timer": 300,
            "tips": "酸甜咸宜边尝边调；鱼露偏咸，生抽不宜再多。",
        },
        {
            "no": 5,
            "title": "混合拌匀",
            "content": "大碗中放沥干虾仁、洋葱丝、小番茄、香菜；挤汁后的青柠皮切片拌入前务必去籽。倒入酱汁充分抓拌。",
            "timer": 180,
            "tips": "柠檬籽会导致酱汁发苦，务必剔净。",
        },
        {
            "no": 6,
            "title": "冷藏入味",
            "content": "覆保鲜膜冷藏 1–2 小时再食用，味道更透、更清爽开胃；临吃前再轻拌一次。",
            "timer": 3600,
            "tips": "冷藏容器与生熟分开；肠胃敏感期可适当缩短冷藏时间并确保虾仁全程保鲜链安全。",
        },
    ]


EXACT_TITLE_STEPS: dict[str, Any] = {
    "山药滋补红烧牛腩": steps_shanyao_brisket,
    "西红柿山药牛腩": steps_tomato_beef_brisket,
    "金汤柠檬鲈鱼": steps_lemon_bass,
    "坚果腰果虾仁": steps_cashew_shrimp,
    "腐竹黑木耳烧肉": steps_tofu_pork,
    "板栗红枣炖乌鸡": steps_chicken_stew,
}


def pick_thai_shrimp(title: str) -> bool:
    t = title
    return ("泰式" in t or "青柠" in t) and ("虾" in t or "虾仁" in t)


# ---------- 模板：种子荤/素与其它菜型 ----------

def parse_meat_title(title: str) -> tuple[str, str, str]:
    """返回 (style_prefix, core, pair) 尽力解析。"""
    t = strip_suffix(title)
    if "烧" not in t:
        return "", t, ""
    a, _, b = t.partition("烧")
    return "", a, b


def meat_kind_from_core(core: str) -> str:
    if any(k in core for k in ("鲈鱼", "带鱼")):
        return "fish"
    if any(k in core for k in ("虾仁", "鱿鱼")):
        return "seafood"
    if any(k in core for k in ("鸡", "鸭")):
        return "poultry"
    return "red_meat"


def heavy_meat(title: str, ing: dict, kind: str) -> list[dict]:
    _, core, pair = parse_meat_title(title)
    pair = pair or "配菜"
    salt_g = 3
    oil_ml = 14
    if kind == "fish":
        return [
            {
                "no": 1,
                "title": "处理鱼块",
                "content": f"鱼块洗净擦干，浅盐腌 10 分钟；{pair}洗净切配。葱丝、姜丝备齐。",
                "timer": 600,
                "tips": "鱼皮擦干再煎不易粘锅；孕期选新鲜鱼类，充分加热。",
            },
            {
                "no": 2,
                "title": "煎制定型",
                "content": "平底锅薄油中火，鱼皮朝下煎至两面微黄出香；盛出备用。",
                "timer": 180,
                "tips": "少翻动，待定型再翻面，鱼形更完整。",
            },
            {
                "no": 3,
                "title": "煸香合炒",
                "content": f"余油煸香姜葱，下{pair}翻炒断生，放回鱼块，淋料酒与少量热水焖 2–3 分钟。",
                "timer": 180,
                "tips": "加水勿多，半焖半收汁更入味。",
            },
            {
                "no": 4,
                "title": "调味收汁",
                "content": f"生抽、蚝油（或豉油）调味，尝咸淡后中火收汁；出锅前点香油可选。",
                "timer": 120,
                "tips": "收汁后再补盐，鱼肉不易柴。",
            },
            {
                "no": 5,
                "title": "装盘与搭配",
                "content": "装盘撒葱丝；建议搭配杂粮饭与焯水绿叶菜，一餐膳食纤维与碳水均衡。",
                "timer": 0,
                "tips": "对鱼类过敏者请遵医嘱替换蛋白来源。",
            },
        ]
    if kind == "seafood":
        return [
            {
                "no": 1,
                "title": "预处理海鲜",
                "content": "虾仁去肠线吸干；或鱿鱼切花刀，沸水快焯 10 秒沥干。配菜洗净备用。",
                "timer": 30,
                "tips": "焯水温要高、时间短，避免海鲜变老。",
            },
            {
                "no": 2,
                "title": "爆香快炒",
                "content": f"热锅 {oil_ml}ml 油，姜蒜煸香，大火下海鲜快速翻炒至变色。",
                "timer": 90,
                "tips": "全程大火快炒锁汁；海鲜务必完全熟透。",
            },
            {
                "no": 3,
                "title": "合入配菜",
                "content": f"加入{pair}翻炒断生，盐约 {salt_g}g、薄盐生抽调味，可选勾薄芡。",
                "timer": 120,
                "tips": "甲壳类过敏者勿选虾仁菜式；可换鸡肉丁。",
            },
            {
                "no": 4,
                "title": "出锅品尝",
                "content": "翻炒均匀立刻出锅；配一碗米饭与一份凉拌黄瓜补充膳食纤维。",
                "timer": 0,
                "tips": "孕期控盐可用香菇粉、柠檬汁提鲜。",
            },
        ]
    if kind == "poultry":
        return [
            {
                "no": 1,
                "title": "切丁腌制",
                "content": "禽肉切丁或片，加料酒 5ml、淀粉 8g、少量盐抓匀腌 15 分钟。",
                "timer": 900,
                "tips": "浆不宜过厚，便于快速炒熟透。",
            },
            {
                "no": 2,
                "title": "滑炒至变色",
                "content": f"热锅冷油滑散肉丁至变色盛出；余油炒香{pair}。",
                "timer": 180,
                "tips": "禽肉须全熟再食用；中心无粉红色。",
            },
            {
                "no": 3,
                "title": "回锅合味",
                "content": "倒回肉丁，生抽调味，大火翻匀；如需酱香可加少许豆瓣酱（辣度自控）。",
                "timer": 120,
                "tips": "孕吐期避开过辣过油；可在出锅前滴几滴柠檬汁解腻。",
            },
            {
                "no": 4,
                "title": "营养提示",
                "content": "禽肉脂肪低于畜肉；搭配深色蔬菜与全谷物主食完成一餐。",
                "timer": 0,
                "tips": "剩菜复热须彻底热透。",
            },
        ]
    # red_meat
    return [
        {
            "no": 1,
            "title": "焯水去沫",
            "content": "肉切块冷水下锅，加葱姜料酒，煮沸撇沫后捞出温水冲洗沥干。",
            "timer": 300,
            "tips": "温水冲洗防止肉质发柴；浮沫撇净减少腥味。",
        },
        {
            "no": 2,
            "title": "煸炒上色",
            "content": f"少油中火煸炒肉块至边缘焦香，下葱姜与{pair}翻炒出香味。",
            "timer": 240,
            "tips": "煸炒上色后再加水焖，酱香更足。",
        },
        {
            "no": 3,
            "title": "焖软入味",
            "content": "加热水至食材一半高度，生抽、老抽、冰糖调味，小火焖 25–40 分钟至软烂。",
            "timer": 2100,
            "tips": "孕妇控糖可减少冰糖；盐宜后放。",
        },
        {
            "no": 4,
            "title": "收汁亮油",
            "content": "转中火收汁至汤汁挂勺，尝味补盐；出锅装盘。",
            "timer": 300,
            "tips": "红肉补铁，配富含维生素 C 的蔬菜促进吸收。",
        },
        {
            "no": 5,
            "title": "一餐搭配",
            "content": "建议搭配半盘焯水西兰花或甜椒，一碗杂粮饭；饮品可选无糖豆浆或温水。",
            "timer": 0,
            "tips": "隔夜红烧肉类须冷藏并在 24 小时内复热彻底吃完。",
        },
    ]


def heavy_veg(title: str, _ing: dict) -> list[dict]:
    veg = strip_suffix(title)
    for vp in VEG_PREFIX:
        if veg.startswith(vp):
            veg = veg[len(vp) :].strip()
            break
    veg = veg or "时蔬"
    oil_ml = 12
    return [
        {
            "no": 1,
            "title": "浸泡洗净切配",
            "content": f"{veg}流水冲洗，必要时淡盐水浸泡 5 分钟再冲净；按菜式切段、撕片或去皮切块。蒜切末，小葱切段。",
            "timer": 300,
            "tips": "叶菜建议先洗再切，减少营养流失；农药残留风险高时可焯水再炒。",
        },
        {
            "no": 2,
            "title": "烹制（按技法）",
            "content": _veg_step_cook_sentence(title, veg, oil_ml),
            "timer": 240,
            "tips": "孕期蔬菜建议做熟做透；凉拌亦先将食材焯水再过凉，降低微生物风险。",
        },
        {
            "no": 3,
            "title": "调味细节",
            "content": "盐与薄盐生抽分次少量加入，边尝边调；醋溜或凉拌可加少量糖平衡酸味。",
            "timer": 60,
            "tips": "控盐可用香菇粉、蒜蓉、芝麻增香减盐。",
        },
        {
            "no": 4,
            "title": "装盘与保存",
            "content": "装盘现吃口感最佳；剩余蔬菜趁热密封冷藏，再次食用须彻底加热。",
            "timer": 0,
            "tips": "全天蔬菜目标约 400–500g，可分多餐搭配优质蛋白。",
        },
    ]


def _veg_step_cook_sentence(title: str, veg: str, oil_ml: int) -> str:
    if "白灼" in title:
        return f"沸水加少许油盐，下{veg}焯烫 45–60 秒捞出沥水，淋蒸鱼豉油或薄盐生抽，撒葱丝。"
    if "凉拌" in title:
        return f"{veg}焯水 30–45 秒过凉沥干，加蒜末、薄盐生抽、香醋、芝麻油拌匀。"
    if "上汤" in title:
        return f"清水或高汤烧开，下{veg}煮 2–3 分钟，盐调味，少油即可。"
    if "蚝油" in title or "蒜蓉" in title:
        return f"热锅 {oil_ml}ml 油爆香蒜末，大火快炒{veg} 2–3 分钟，蚝油与薄盐生抽调味。"
    if "醋溜" in title:
        return f"热锅少油炒软{veg}，先加糖与盐，沿锅边淋米醋翻匀，保持脆口出锅。"
    return f"热锅 {oil_ml}ml 油大火翻炒{veg} 2–3 分钟断生，盐与少量生抽调味。"


def heavy_generic(title: str, ing: dict) -> list[dict]:
    hint = ing_text(ing)[:120]
    return [
        {
            "no": 1,
            "title": "备料与预处理",
            "content": f"根据菜谱「{strip_suffix(title)}」准备主料与辅料：{hint or '按家中食材适量'}；肉类流水冲洗、蔬菜浸泡冲洗沥干，配料切丁切丝分开放置。",
            "timer": 600,
            "tips": "生熟砧板分开；肉类与即食食材避免交叉污染。",
        },
        {
            "no": 2,
            "title": "关键火候烹制",
            "content": "先处理需长时间软糯的食材（焯、煸、焖），再加入易熟食材；全程注意火力切换，避免外焦里生。",
            "timer": 900,
            "tips": "孕期食材务必熟透；禽畜水产中心温度达到安全范围再食用。",
        },
        {
            "no": 3,
            "title": "调味与层次",
            "content": "盐、酱、糖少量多次加入，边尝边调；可先淡后咸，收汁前再最终校正口味。",
            "timer": 120,
            "tips": "可用柠檬汁、香菇粉提鲜减钠。",
        },
        {
            "no": 4,
            "title": "收汁装盘",
            "content": "需要勾芡时少量淀粉水分次淋入推匀；装盘注意荤素配色与温度，趁热食用风味最佳。",
            "timer": 180,
            "tips": "汤汁浓稠宜适中，避免过多勾芡导致隐形碳水过高。",
        },
        {
            "no": 5,
            "title": "一餐搭配建议",
            "content": "一餐建议：优质蛋白 + 半盘蔬菜 + 适量全谷物主食；饮品白开水或无糖豆浆为宜。",
            "timer": 0,
            "tips": "医嘱有特殊禁忌（糖耐量、甲功、过敏）时以医生指导为准。",
        },
    ]


def detect_generic_archetype(title: str) -> str:
    t = strip_suffix(title)
    if any(x in t for x in ("汤", "煲", "羹", "炖盅")):
        return "soup"
    if "蒸" in t or "清蒸" in t:
        return "steam"
    if any(x in t for x in ("红烧", "焖", "酱烧", "卤")):
        return "braise"
    if any(x in t for x in ("煎", "煸")):
        return "stir"
    if any(x in t for x in ("拌", "凉拌", "色拉")):
        return "cold"
    return "generic"


def heavy_by_archetype(title: str, ing: dict, arch: str) -> list[dict]:
    if arch == "soup":
        return [
            {
                "no": 1,
                "title": "食材分拨准备",
                "content": "肉类焯水去沫，干货泡发洗净；根茎类去皮切块，叶菜类最后清洗切段，避免营养流失。",
                "timer": 600,
                "tips": "煲汤肉类可先焯水再炖，汤色更清。",
            },
            {
                "no": 2,
                "title": "大火煮沸转小火",
                "content": "冷水或热水下锅按食材特性选择，煮沸撇沫后转小火慢炖，保持微沸状态使鲜味缓慢释放。",
                "timer": 2700,
                "tips": "孕期少喝过于油腻的表层浮油，可用吸油纸或撇去浮油。",
            },
            {
                "no": 3,
                "title": "分时段下料",
                "content": "耐煮食材先下锅，易熟食材后放；盐一般在收尾阶段加入，避免肉质过紧。",
                "timer": 600,
                "tips": "长时间炖煮注意补水须用热水，避免温度骤降。",
            },
            {
                "no": 4,
                "title": "调味与份量",
                "content": "淡淡为宜，少量盐与胡椒粉即可；一碗汤搭配主食与蔬菜完成一餐。",
                "timer": 0,
                "tips": "尿酸偏高或肾功能受限者遵医嘱控制浓汤与内脏汤底。",
            },
        ]
    if arch == "steam":
        return [
            {
                "no": 1,
                "title": "腌制与摆盘",
                "content": "主料抹薄盐、姜片料酒腌制去腥；盘底铺葱姜丝防粘并增香。",
                "timer": 600,
                "tips": "蒸鱼蒸肉都应「水开后再上锅」，计时更准确。",
            },
            {
                "no": 2,
                "title": "旺火蒸制",
                "content": "蒸锅水沸腾后放入，大火按体积计时；鱼类一般 6–10 分钟，禽肉更久，以内部熟透为准。",
                "timer": 480,
                "tips": "蒸过头肉质变老；可用筷子戳最厚处无血水渗出判断熟度。",
            },
            {
                "no": 3,
                "title": "淋汁提鲜",
                "content": "倒出腥水，淋蒸鱼豉油或薄盐生抽，泼少量热油激香；撒葱丝上桌。",
                "timer": 60,
                "tips": "孕期控制泼油量，可用热橄榄油少量代替。",
            },
            {
                "no": 4,
                "title": "搭配杂粮饭",
                "content": "配杂粮饭与焯水西兰花等深色蔬菜，一餐营养更完整。",
                "timer": 0,
                "tips": "蒸菜少油烟，适合孕期胃口不稳时食用。",
            },
        ]
    if arch == "braise":
        return heavy_meat(title, ing, "red_meat")
    if arch == "cold":
        return [
            {
                "no": 1,
                "title": "主料熟处理",
                "content": "凉拌肉类或海鲜先焯水或蒸熟透，过饮用水冰块沥干；蔬菜焯水再过凉保持色泽口感。",
                "timer": 300,
                "tips": "孕期减少生冷风险：食材预熟后再拌，酱汁另调。",
            },
            {
                "no": 2,
                "title": "酱汁平衡",
                "content": "蒜末、酱油、醋、糖、香油少量多次调和，酸甜咸平衡；可加少量辣椒油（可选）。",
                "timer": 180,
                "tips": "孕早期肠胃敏感者少辣少酸，可用香菜、芝麻增香。",
            },
            {
                "no": 3,
                "title": "拌匀入味",
                "content": "大盆拌匀后覆膜冷藏 15–30 分钟更入味，食用前再轻拌。",
                "timer": 900,
                "tips": "冷藏不超过 24 小时，夏季注意链条卫生。",
            },
            {
                "no": 4,
                "title": "一餐搭配",
                "content": "配热粥或杂粮饭与一份热汤，避免全程冷食刺激胃肠。",
                "timer": 0,
                "tips": "海鲜凉拌须确保新鲜度与熟透度。",
            },
        ]
    return heavy_generic(title, ing)


def light_enrich_steps(steps_norm: list[dict]) -> list[dict]:
    """在已有较细步骤上补全 tips、略增文案，不缩短原文。"""
    out = []
    for i, s in enumerate(steps_norm):
        content = s.get("content", "")
        tips = (s.get("tips") or "").strip()
        if not tips:
            if i == 0:
                tips = "准备阶段注意生熟分开与食材新鲜度。"
            elif i == len(steps_norm) - 1:
                tips = "出锅前尝味再补盐；剩菜及时冷藏并彻底复热。"
            else:
                tips = "注意火力与时长，避免外焦里生或未熟透。"
        extra = ""
        if (
            "焯水" in content
            and "温水" not in content
            and "肉质骤冷" not in content
            and any(x in content for x in ("肉", "牛腩", "排骨", "鸡", "猪"))
        ):
            extra = "（肉类焯水后建议温水冲洗，避免肉质骤冷变柴。）"
        new_content = content
        if extra and extra not in content:
            new_content = content + extra
        out.append(
            {
                "no": s["no"],
                "title": s["title"],
                "content": new_content,
                "timer": int(s.get("timer") or 0),
                "tips": tips,
            }
        )
    return out


def merge_nutrition(old: str, addon: str) -> str:
    old = (old or "").strip()
    addon = (addon or "").strip()
    if not addon:
        return old
    if addon in old:
        return old
    if "个体禁忌请咨询医生" in old and "个体禁忌请咨询医生" in addon:
        return old
    sep = "" if old.endswith(("。", "！", "？")) else "。"
    return f"{old}{sep}{addon}" if old else addon


def nutrition_addon_for_arch(title: str, arch_hint: str) -> str:
    if arch_hint == "fish":
        return "鱼类可提供优质蛋白与 DHA，每周可按医嘱均衡摄入；过敏者替换食材。"
    if arch_hint == "seafood":
        return "海鲜富含优质蛋白与锌，注意新鲜与熟透；甲壳类过敏者避免。"
    if arch_hint == "pregnancy_balance":
        return "一日三餐注意荤素搭配与足量饮水，特殊情况遵医嘱。"
    return "孕期饮食以清淡少油、食材多样为原则，个体禁忌请咨询医生。"


def build_new_row(row: dict) -> dict[str, Any] | None:
    """返回需 PATCH 的字段；None 表示跳过。"""
    title = row.get("title") or ""
    ing = row.get("ingredients")
    if isinstance(ing, str):
        try:
            ing = json.loads(ing)
        except json.JSONDecodeError:
            ing = {}
    if not isinstance(ing, dict):
        ing = {}

    steps_raw = row.get("steps")
    if isinstance(steps_raw, str):
        try:
            steps_raw = json.loads(steps_raw)
        except json.JSONDecodeError:
            steps_raw = []
    steps_norm = normalize_steps(steps_raw)
    score = detail_score(steps_norm)

    new_steps: list[dict] | None = None
    cooking_time = row.get("cooking_time") or ""
    nutrition = row.get("nutrition_insight") or ""
    arch_note = "pregnancy_balance"

    # 1) 精确标题：迁移库手工菜谱
    base_title = strip_suffix(title)
    if base_title in EXACT_TITLE_STEPS:
        fn = EXACT_TITLE_STEPS[base_title]
        new_steps = fn(ing) if callable(fn) else fn
        arch_note = "pregnancy_balance"
    elif pick_thai_shrimp(title):
        new_steps = steps_thai_lime_shrimp(ing)
        cooking_time = "约 40 分钟（含冷藏入味）"
        arch_note = "seafood"
    elif needs_heavy_rewrite(title, steps_norm, score):
        t_clean = strip_suffix(title)
        if "烧" in t_clean and any(c in t_clean for c in MEAT_CORE):
            core = ""
            for c in MEAT_CORE:
                if c in t_clean:
                    core = c
                    break
            kind = meat_kind_from_core(core)
            new_steps = heavy_meat(title, ing, kind)
            arch_note = kind
        elif any(t_clean.startswith(vp) for vp in VEG_PREFIX):
            new_steps = heavy_veg(title, ing)
            arch_note = "pregnancy_balance"
        else:
            ga = detect_generic_archetype(title)
            new_steps = heavy_by_archetype(title, ing, ga)
            arch_note = "pregnancy_balance"
    else:
        new_steps = light_enrich_steps(steps_norm)

    assert new_steps is not None

    skip_nut_addon = base_title in EXACT_TITLE_STEPS
    if not skip_nut_addon:
        nutrition = merge_nutrition(
            nutrition, nutrition_addon_for_arch(title, arch_note)
        )
    if len(nutrition) > 1200:
        nutrition = nutrition[:1197] + "..."

    patch: dict[str, Any] = {
        "steps": new_steps,
        "nutrition_insight": nutrition,
    }
    if cooking_time and cooking_time != row.get("cooking_time"):
        patch["cooking_time"] = cooking_time

    # 若与规范化后仅有微小变化，仍写库统一格式（steps 字段对齐）
    return patch


def patch_recipe(base: str, anon: str, rid: str, body: dict) -> None:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    url = f"{base}/rest/v1/pregnancy_recipes?id=eq.{quote(rid, safe='')}"
    code, data = http_json("PATCH", url, headers, body)
    if code not in (200, 204):
        raise RuntimeError(f"PATCH failed {code}: {data}")


def main() -> int:
    load_supabase_env(ROOT)
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="最多处理多少条，0 表示全部")
    args = ap.parse_args()

    base = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    anon = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    if not base or not anon:
        print("需要 SUPABASE_URL 与 SUPABASE_ANON_KEY", file=sys.stderr)
        return 1

    rows = fetch_all_recipes(base, anon)
    if args.limit:
        rows = rows[: args.limit]

    print(f"Loaded {len(rows)} recipes to process.", flush=True)

    ok = 0
    jobs: list[tuple[str, str, dict]] = []
    for row in rows:
        rid = row.get("id")
        title = row.get("title", "")
        if not rid:
            continue
        try:
            patch = build_new_row(row)
            if not patch:
                continue
            if args.dry_run:
                steps = patch.get("steps") or []
                print(f"[dry-run] {title[:40]} -> {len(steps)} steps", flush=True)
                ok += 1
            else:
                jobs.append((rid, title, patch))
        except Exception as e:
            print(f"ERROR {title}: {e}", file=sys.stderr)
            return 1

    if not args.dry_run and jobs:

        def _do_patch(item: tuple[str, str, dict]) -> tuple[str, bool, str | None]:
            rid, title, patch = item
            try:
                patch_recipe(base, anon, rid, patch)
                return (title, True, None)
            except Exception as ex:
                return (title, False, str(ex))

        workers = min(12, max(4, len(jobs) // 20 + 4))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(_do_patch, j) for j in jobs]
            for n, fut in enumerate(as_completed(futs), 1):
                title, success, err = fut.result()
                if success:
                    ok += 1
                else:
                    print(f"PATCH FAIL {title}: {err}", file=sys.stderr)
                    return 1
                if n % 40 == 0:
                    print(f"Patched {n}/{len(jobs)}...", flush=True)

    if args.dry_run:
        print("Dry-run complete, no writes.", flush=True)
    else:
        print(f"Done. Patched {ok} recipes.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
