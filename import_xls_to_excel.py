import pandas as pd
import traceback
import os
import warnings
import re
from datetime import datetime

warnings.filterwarnings('ignore')

# ================= 月份映射 =================
MONTH_MAP = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'jun': 6, 'jul': 7, 'aug': 8,
    'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
    '一月': 1, '二月': 2, '三月': 3, '四月': 4, '五月': 5, '六月': 6,
    '七月': 7, '八月': 8, '九月': 9, '十月': 10, '十一月': 11, '十二月': 12,
    'januar': 1, 'februar': 2, 'märz': 3, 'maerz': 3, 'mai': 5, 'juni': 6,
    'juli': 7, 'oktober': 10, 'dezember': 12,
    'janvier': 1, 'février': 2, 'fevrier': 2, 'mars': 3, 'avril': 4,
    'juillet': 7, 'août': 8, 'aout': 8, 'septembre': 9, 'octobre': 10,
    'novembre': 11, 'décembre': 12, 'decembre': 12,
    'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4, 'maggio': 5,
    'giugno': 6, 'luglio': 7, 'agosto': 8, 'settembre': 9, 'ottobre': 10,
    'dicembre': 12,
    'enero': 1, 'febrero': 2, 'abril': 4, 'mayo': 5, 'junio': 6,
    'julio': 7, 'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
}

# 全字段列名（与建表顺序一致）
ALL_COLUMNS = [
    'yearmo', 'site', 'asin', 'collect_time', 'collect_status',
    'product_url', 'remark', 'mark', 'delivery_time',
    'earliest_delivery_days', 'latest_delivery_days',
    'package_weight_converted_kg', 'price_usd', 'usd_exchange_rate', 'launch_days',
    'brand', 'brand_url', 'image_url', 'title', 'parent_asin',
    'node_id', 'node_id_path', 'category_path',
    'bsr_id', 'bsr_rank', 'bsr_growth_rate', 'bsr_growth_num',
    'monthly_sales', 'monthly_sales_growth_rate', 'sales_30d',
    'sales_update_time', 'monthly_revenue', 'price', 'prime_price',
    'gross_margin_rate', 'fba_fee', 'rating_count', 'review_rate',
    'rating', 'rating_growth_num', 'monthly_new_rating',
    'listing_quality_score', 'launch_time', 'fulfillment_type',
    'variation_count', 'seller_count', 'seller_id', 'seller_name',
    'seller_country', 'is_best_seller', 'is_amazon_choice',
    'is_new_release', 'is_a_plus', 'has_video',
    'weight', 'size_desc', 'size_type', 'package_weight',
    'sub_category_json', 'sku', 'seller_shipping_fee', 'is_hot_sale',
    'doris_import_time', 'etl_time'
]

# ================= 配送时间解析 =================

def clean_delivery_text(text):
    if not isinstance(text, str):
        text = str(text)
    text = text.lower().strip()
    text = text.replace('–', '-').replace('—', '-')
    weekdays = [
        "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
        "montag","dienstag","mittwoch","donnerstag","freitag","samstag","sonntag",
        "lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche",
        "lunes","martes","miércoles","jueves","viernes","sábado","domingo",
        "lunedì","martedì","mercoledì","giovedì","venerdì","sabato","domenica",
        "星期一","星期二","星期三","星期四","星期五","星期六","星期日","星期天",
        "周一","周二","周三","周四","周五","周六","周日"
    ]
    for w in weekdays:
        text = text.replace(w, "")
    text = re.sub(r'[月火水木金土日]曜日', '', text)
    return text.strip(', ')


def extract_month_day(part_str):
    if not part_str:
        return 0, 0
    day, month = 0, 0
    jp_match = re.search(r'(\d+)\s*月\s*(\d+)', part_str)
    if jp_match:
        return int(jp_match.group(1)), int(jp_match.group(2))
    month_word_match = re.search(r'([a-zA-Zäöüßéáíóúñû\u4e00-\u9fa5]+)', part_str)
    if month_word_match:
        month = MONTH_MAP.get(month_word_match.group(1), 0)
    day_match = re.search(r'(\d+)', part_str)
    if day_match:
        day = int(day_match.group(1))
    return month, day


def calculate_date_obj(m, d, current_year, base_date):
    if m == 0 or d == 0:
        return None
    try:
        dt = datetime(current_year, m, d)
        if dt < base_date:
            dt = dt.replace(year=current_year + 1)
        return dt
    except Exception:
        return None


def parse_delivery_days(raw_time_str, collect_time_dt):
    if not raw_time_str:
        return '', ''

    base_date = collect_time_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    current_year = base_date.year

    weekday = collect_time_dt.weekday()
    adjust = -2 if weekday in (3, 4) else (-1 if weekday == 5 else 0)

    clean_val = clean_delivery_text(raw_time_str)
    if not clean_val or clean_val in ['-', '.', 'nan', '']:
        return '', ''

    raw_parts = [p.strip() for p in clean_val.split(',') if any(c.isdigit() for c in p)]
    if not raw_parts:
        return '', ''

    first_part = raw_parts[0]
    separator = ' bis ' if ' bis ' in first_part else (' to ' if ' to ' in first_part else '-')
    has_separator = separator in first_part and separator != first_part
    target_parts = [first_part] if has_separator else raw_parts

    all_valid_dates = []
    for part in target_parts:
        sep = ' bis ' if ' bis ' in part else (' to ' if ' to ' in part else '-')
        if sep in part and sep != part:
            range_split = part.split(sep)
            if len(range_split) >= 2:
                m1, d1 = extract_month_day(range_split[0].strip())
                m2, d2 = extract_month_day(range_split[1].strip())
                if m2 == 0 and m1 > 0: m2 = m1
                if m1 == 0 and m2 > 0: m1 = m2
                dt1 = calculate_date_obj(m1, d1, current_year, base_date)
                dt2 = calculate_date_obj(m2, d2, current_year, base_date)
                if dt1: all_valid_dates.append(dt1)
                if dt2: all_valid_dates.append(dt2)
        else:
            m, d = extract_month_day(part)
            dt = calculate_date_obj(m, d, current_year, base_date)
            if dt: all_valid_dates.append(dt)

    if not all_valid_dates:
        return '', ''

    all_valid_dates.sort()
    earliest_days = max((all_valid_dates[0] - base_date).days + 1 + adjust, 0)
    latest_days   = max((all_valid_dates[-1] - base_date).days + 1 + adjust, 0)
    return str(earliest_days), str(latest_days)


# ================= 工具函数 =================

def clean(v):
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    s = str(v).strip()
    return None if s.lower() in ('nan', 'none', '') else s


def clean_limit_bytes(v, max_bytes, default=''):
    s = clean(v)
    if not s:
        return default
    encoded = s.encode('utf-8')
    return s if len(encoded) <= max_bytes else encoded[:max_bytes].decode('utf-8', errors='ignore')


def clean_not_null(v, default=''):
    s = clean(v)
    return s if s is not None else default


def to_datetime(v):
    s = clean(v)
    if not s:
        return None
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M:%S', '%Y-%m-%d', '%Y/%m/%d'):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


# ================= 主函数 =================

def import_xls_to_excel(str1, str3, str4, str5):
    # str1: 根文件夹，遍历其下所有子文件夹内的 .xls 文件
    # str3: yearmo
    # str4: 输出文件夹路径，不存在则创建，每个国家一个xlsx（增量累加）
    # str5: 本次数据库记录列表（部分数据）

    log_messages = []
    def log(msg):
        log_messages.append(str(msg))

    # 时效字段（采集文件覆盖）
    DELIVERY_COLS = [
        'collect_time', 'collect_status', 'product_url', 'remark',
        'mark', 'delivery_time', 'earliest_delivery_days',
        'latest_delivery_days', 'etl_time'
    ]

    try:
        log("=== 开始执行 ===")
        log(f"根文件夹: {str1}")
        log(f"年月(yearmo): {str3}")
        log(f"输出目录: {str4}")

        yearmo_val = clean(str3) or ''

        # ===== 1. 创建输出目录 =====
        if not os.path.exists(str4):
            os.makedirs(str4)
            log(f"已创建输出目录: {str4}")
        else:
            log(f"输出目录已存在: {str4}")

        # ===== 2. str5 → 以 (asin, site) 为 key 的字典 =====
        db_by_asin_site = {}
        db_by_asin = {}
        for item in (str5 or []):
            item_lower = {k.lower(): v for k, v in item.items()}
            asin_key = str(item_lower.get("asin", "")).strip().upper()
            site_key = str(item_lower.get("site", "")).strip().upper()
            if asin_key:
                db_by_asin_site[(asin_key, site_key)] = item_lower
                db_by_asin[asin_key] = item_lower
        log(f"本次DB记录数: {len(db_by_asin_site)}")

        # ===== 3. 读取 str4 中已有的所有 Excel，作为历史底数 =====
        # 结构: existing[site_val] = {asin: record_dict}
        existing = {}
        if os.path.isdir(str4):
            for fname in os.listdir(str4):
                if not fname.endswith('.xlsx'):
                    continue
                site_val = os.path.splitext(fname)[0].upper()
                fpath = os.path.join(str4, fname)
                try:
                    old_df = pd.read_excel(fpath, dtype=str)
                    old_df.columns = [c.lower() for c in old_df.columns]
                    for col in ALL_COLUMNS:
                        if col not in old_df.columns:
                            old_df[col] = None
                    existing[site_val] = {
                        str(row['asin']).strip().upper(): row.to_dict()
                        for _, row in old_df.iterrows()
                        if str(row.get('asin','')).strip().upper() not in ('', 'NAN', 'NONE')
                    }
                    log(f"读取已有Excel [{fname}]，{len(existing[site_val])} 条历史记录")
                except Exception as e:
                    # 文件损坏：直接删除，本次重新生成
                    try:
                        os.remove(fpath)
                        log(f"读取已有Excel [{fname}] 失败（文件损坏已删除），本次重新生成: {e}")
                    except Exception as del_err:
                        log(f"读取已有Excel [{fname}] 失败，删除也失败: {e} | {del_err}")
                    existing[site_val] = {}

        # ===== 4. 遍历 str1 下所有子文件夹 =====
        if not os.path.isdir(str1):
            return f"根文件夹不存在: {str1}"

        subfolders = [
            os.path.join(str1, d) for d in os.listdir(str1)
            if os.path.isdir(os.path.join(str1, d))
        ]
        if not subfolders:
            return f"根文件夹下没有子文件夹: {str1}"

        log(f"发现 {len(subfolders)} 个子文件夹: {[os.path.basename(d) for d in subfolders]}")

        # ===== 5. 本次采集处理结果（只含本次命中的） =====
        # 结构: new_results[site_val][asin] = record_dict
        new_results = {}
        current_etl = datetime.now()
        total_hit = 0
        total_skip = 0

        for folder in subfolders:
            folder_name = os.path.basename(folder)
            xls_files = [
                os.path.join(folder, f) for f in os.listdir(folder)
                if os.path.isfile(os.path.join(folder, f))
                and not f.startswith('~$')
                and not f.startswith('.')
                and os.path.splitext(f)[1].lower() == '.xls'
            ]
            if not xls_files:
                log(f"  [{folder_name}] 没有 .xls 文件，跳过")
                continue

            log(f"  [{folder_name}] 发现 {len(xls_files)} 个 .xls 文件")

            dfs = []
            for fpath in xls_files:
                fname = os.path.basename(fpath)
                file_df = None
                for enc in ('utf-16', 'utf-8'):
                    try:
                        file_df = pd.read_csv(fpath, sep='\t', encoding=enc, dtype=str)
                        if file_df is not None and not file_df.empty:
                            log(f"    [{fname}] {enc.upper()} TSV 读取成功，{len(file_df)} 行")
                            break
                    except Exception:
                        continue
                if file_df is None:
                    try:
                        file_df = pd.read_excel(fpath, engine='xlrd', dtype=str)
                        log(f"    [{fname}] XLS(xlrd) 读取成功，{len(file_df)} 行")
                    except Exception as e:
                        log(f"    [{fname}] 读取失败，跳过: {e}")
                if file_df is not None and not file_df.empty:
                    file_df.columns = [str(col).strip() for col in file_df.columns]
                    dfs.append(file_df)

            if not dfs:
                log(f"  [{folder_name}] 所有文件均读取失败，跳过")
                continue

            df = pd.concat(dfs, ignore_index=True)
            log(f"  [{folder_name}] 合并完成，共 {len(df)} 行")

            col_map = {col.lower().replace(' ', ''): col for col in df.columns}
            def real_col(name):
                return col_map.get(name.lower().replace(' ', ''))

            col_asin           = real_col("ASIN")
            col_site           = real_col("国家")
            col_collect_time   = real_col("采集时间")
            col_collect_status = real_col("状态")
            col_product_url    = real_col("产品网址")
            col_remark         = real_col("备注")
            col_delivery       = real_col("配送时间")

            if not col_asin:
                log(f"  [{folder_name}] 未找到ASIN列，跳过")
                continue
            if not col_site:
                log(f"  [{folder_name}] 未找到国家列，跳过")
                continue

            before = len(df)
            df = df.drop_duplicates(subset=[col_asin, col_site], keep='last').reset_index(drop=True)
            if len(df) < before:
                log(f"  [{folder_name}] 去重后 {len(df)} 行（移除 {before-len(df)} 条）")

            hit_count = skip_count = 0
            for _, row in df.iterrows():
                asin = clean(row[col_asin]) if col_asin else None
                if not asin:
                    skip_count += 1
                    continue
                asin_upper = asin.upper()

                # 跳过采集失败的行（严格全文匹配）
                if col_collect_status:
                    status_val = clean(row[col_collect_status]) or ''
                    if status_val == '采集失败，没有获取到数据(请求失败或网络异常)':
                        skip_count += 1
                        continue

                country_raw = clean(row[col_site]) if col_site else None
                site_val = (country_raw or '').upper()

                db_row = db_by_asin_site.get((asin_upper, site_val)) or db_by_asin.get(asin_upper)
                if not db_row:
                    skip_count += 1
                    continue

                if site_val not in new_results:
                    new_results[site_val] = {}

                if asin_upper not in new_results[site_val]:
                    record = {col: db_row.get(col) for col in ALL_COLUMNS}
                    record['yearmo'] = record.get('yearmo') or yearmo_val
                    record['site']   = record.get('site') or site_val
                    record['asin']   = asin_upper
                    new_results[site_val][asin_upper] = record

                collect_time   = (to_datetime(row[col_collect_time]) if col_collect_time else None) or datetime.now()
                collect_status = clean_limit_bytes(row[col_collect_status] if col_collect_status else None, 30, default='')
                product_url    = clean_not_null(row[col_product_url] if col_product_url else None)
                remark         = clean_not_null(row[col_remark] if col_remark else None)
                raw_delivery   = clean(row[col_delivery] if col_delivery else None)
                delivery_time  = clean_limit_bytes(raw_delivery, 40, default='')
                earliest_days, latest_days = parse_delivery_days(raw_delivery, collect_time)

                new_results[site_val][asin_upper].update({
                    'collect_time':           collect_time,
                    'collect_status':         collect_status,
                    'product_url':            product_url,
                    'remark':                 remark,
                    'mark':                   '1',
                    'delivery_time':          delivery_time,
                    'earliest_delivery_days': earliest_days,
                    'latest_delivery_days':   latest_days,
                    'etl_time':               current_etl,
                })
                hit_count += 1

            log(f"  [{folder_name}] 命中 {hit_count} 条，跳过(DB无记录) {skip_count} 条")
            total_hit  += hit_count
            total_skip += skip_count

        log(f"本次采集命中: {total_hit} 条，跳过: {total_skip} 条")

        # ===== 6. 合并：历史数据 + 本次新数据 → 写入Excel =====
        # 所有涉及的 site = 历史已有 + 本次新增
        all_sites = set(existing.keys()) | set(new_results.keys())
        log(f"涉及国家(含历史): {sorted(all_sites)}")

        for site_val in all_sites:
            old_map = existing.get(site_val, {})     # 历史记录
            new_map = new_results.get(site_val, {})  # 本次新记录

            # 合并策略：
            # - 历史有、本次也有 → 只更新时效字段，其余保留历史值
            # - 历史有、本次没有 → 完全保留历史
            # - 历史没有、本次有 → 整行写入
            merged = dict(old_map)  # 以历史为底

            for asin, new_rec in new_map.items():
                if asin in merged:
                    # 只覆盖时效字段
                    for col in DELIVERY_COLS:
                        if col in new_rec:
                            merged[asin][col] = new_rec.get(col)
                else:
                    # 新增整行
                    merged[asin] = new_rec

            out_df = pd.DataFrame(list(merged.values()))
            # 确保列顺序和完整性
            for col in ALL_COLUMNS:
                if col not in out_df.columns:
                    out_df[col] = None
            out_df = out_df[ALL_COLUMNS]

            out_path = os.path.join(str4, f"{site_val}.xlsx")
            out_df.to_excel(out_path, index=False, engine='openpyxl')
            log(f"已输出: {out_path}，共 {len(out_df)} 条（历史:{len(old_map)} 新增:{len(new_map)-len(set(new_map)&set(old_map))} 更新时效:{len(set(new_map)&set(old_map))}）")

        log("=== 运行结束 ===")
        return "\n".join(log_messages)

    except Exception:
        return traceback.format_exc()
