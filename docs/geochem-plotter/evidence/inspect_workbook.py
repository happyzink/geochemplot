"""Read-only workbook profiling for the implementation handoff; never saves Excel."""
from pathlib import Path
from collections import Counter
import hashlib
import json
import openpyxl

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / '月球样品数据汇总_all-0910.xlsx'
OUT = Path(__file__).parent
book = openpyxl.load_workbook(SOURCE, data_only=False)
cache = openpyxl.load_workbook(SOURCE, data_only=True)
result = {'file': SOURCE.name, 'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'sheets': []}
for sheet in book:
    rows = list(sheet.iter_rows())
    nonempty = [r for r in rows if any(c.value is not None for c in r)]
    formulas = [c for r in rows for c in r if c.data_type == 'f']
    headers = [{'cell': c.coordinate, 'value': c.value} for c in rows[0] if c.value is not None]
    cols = []
    for j in range(sheet.max_column):
        vals = [r[j] for r in rows[1:] if r[j].value is not None]
        strings = Counter(str(c.value) for c in vals if isinstance(c.value, str) and c.data_type != 'f')
        nums = [c.value for c in vals if isinstance(c.value, (int, float))]
        cols.append({'column': openpyxl.utils.get_column_letter(j+1), 'header': rows[0][j].value,
                     'nonempty': len(vals), 'numeric': len(nums), 'negative': sum(v < 0 for v in nums),
                     'zero': sum(v == 0 for v in nums), 'strings': strings.most_common(30),
                     'examples': [{'cell': c.coordinate, 'value': c.value} for c in vals[:5]]})
    item = {'sheet': sheet.title, 'state': sheet.sheet_state, 'max_row': sheet.max_row,
            'max_column': sheet.max_column, 'nonempty_rows': len(nonempty),
            'merged': [str(r) for r in sheet.merged_cells.ranges],
            'headers_row1': headers,
            'head': [[{'cell': c.coordinate, 'value': c.value} for c in r if c.value is not None] for r in rows[:6]],
            'columns': cols, 'formula_count': len(formulas),
            'formula_cache_missing': sum(cache[sheet.title][c.coordinate].value is None for c in formulas),
            'formula_examples': [{'cell': c.coordinate, 'formula': c.value, 'cached': cache[sheet.title][c.coordinate].value} for c in formulas[:10]],
            'errors': [{'cell': c.coordinate, 'value': c.value} for r in rows for c in r if c.data_type == 'e'][:30]}
    result['sheets'].append(item)
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'workbook_profile.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
for s in result['sheets']:
    print(json.dumps({k: s[k] for k in ['sheet','max_row','max_column','nonempty_rows','merged','formula_count','formula_cache_missing']}, ensure_ascii=False))
    print('HEADERS', json.dumps(s['headers_row1'][:26], ensure_ascii=False))
    meta = [c for c in s['columns'] if c['strings'] and (c['column'] in ['A','B','C','D','E','F'] or any(x in str(c['header']).lower() for x in ['sample','phase','type','mission','lable','label','source','reference','description','comment']))]
    print('META', json.dumps([{k:c[k] for k in ['column','header','nonempty','strings']} for c in meta], ensure_ascii=False))
print('SHA256',result['sha256'])
