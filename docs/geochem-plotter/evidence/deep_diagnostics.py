"""Evidence for planning only. Reads the original, writes JSON/CSV audit files."""
from pathlib import Path
from collections import Counter, defaultdict
import json, csv, re, hashlib
import openpyxl
ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).parent
src = ROOT / '月球样品数据汇总_all-0910.xlsx'
w = openpyxl.load_workbook(src, data_only=False)
v = openpyxl.load_workbook(src, data_only=True)
d = {'bytes':src.stat().st_size, 'sha256':hashlib.sha256(src.read_bytes()).hexdigest(), 'sheets':{}}
with (OUT/'column_inventory.csv').open('w',encoding='utf-8-sig',newline='') as f:
    writer=csv.writer(f); writer.writerow(['sheet','column','header_raw','formula_count','cached_error_count'])
    for s in w:
        rows=list(s.iter_rows()); cs=v[s.title]; headers=[c.value for c in rows[0]]
        errors=[{'cell':c.coordinate,'value':c.value} for rr in cs for c in rr if c.data_type=='e']
        item={'cached_errors_count':len(errors),'cached_errors_examples':errors[:12],
              'duplicate_headers':{str(k):n for k,n in Counter(headers).items() if k is not None and n>1},
              'formula_columns':{},'row2':{c.coordinate:{'header':headers[c.column-1],'formula_or_value':c.value,'cached':cs[c.coordinate].value} for c in rows[1] if c.value is not None}}
        for j,h in enumerate(headers,1):
            cells=[r[j-1] for r in rows[1:]]
            fs=[c for c in cells if c.data_type=='f']
            errs=sum(cs[c.coordinate].data_type=='e' for c in cells)
            writer.writerow([s.title,openpyxl.utils.get_column_letter(j),h,len(fs),errs])
            if fs: item['formula_columns'][openpyxl.utils.get_column_letter(j)]={'header':h,'count':len(fs),'example':fs[0].value,'cache':cs[fs[0].coordinate].value}
        d['sheets'][s.title]=item
s=w['原始实验数据_合并']
d['raw_repeated_headers']=[r[0].row for r in s if r[2].value=='Li7_ppm_mean']
d['raw_missing_sample_rows']=[r[0].row for r in list(s)[1:] if r[0].value is None]
ap=v['Apollo数据']; ap_rows=list(ap)[1:]
d['apollo_74235']=[{'row':r[0].row,'sample':r[0].value,'material':r[6].value,'phase':r[5].value} for r in ap_rows if re.match(r'^74235(?:$|[^0-9])',str(r[0].value))]
d['apollo_material']=dict(Counter(r[6].value for r in ap_rows))
d['apollo_unique_sample_strings']=len(set(str(r[0].value) for r in ap_rows))
# Compare measured chemistry (J:BG) plus mission, sample, object and type; retain multiplicity.
ce=list(v['嫦娥搜集数据'])[1:]; tr=list(v['CE with trace ele'])[1:]
def key(row):
    return tuple(row[j-1].value for j in [5,6,7,9]+list(range(10,60)))
index=defaultdict(list)
for row in ce: index[key(row)].append(row[0].row)
matches=[{'trace_row':row[0].row,'main_rows':index[key(row)]} for row in tr if key(row) in index]
d['trace_overlap']={'comparison':'E,F,G,I,J:BG cached cell values, exact equality; no citation imputation',
                    'trace_rows':len(tr),'matched_rows':len(matches),'multiple_candidates':sum(len(x['main_rows'])>1 for x in matches),'examples':matches[:12]}
d['normalization']=[{'element_text':v['Normalization value'].cell(i,1).value,'value':v['Normalization value'].cell(i,4).value,'row':i} for i in range(4,18)]
(OUT/'workbook_diagnostics.json').write_text(json.dumps(d,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
print(json.dumps({k:val for k,val in d.items() if k not in ['sheets','normalization','apollo_74235']},ensure_ascii=False))
print('74235',json.dumps({'rows':len(d['apollo_74235']),'variants':dict(Counter(str(x['sample']) for x in d['apollo_74235'])),'materials':dict(Counter(x['material'] for x in d['apollo_74235']))},ensure_ascii=False))
for name,item in d['sheets'].items():
    print(name,json.dumps({k:item[k] for k in ['cached_errors_count','cached_errors_examples','duplicate_headers','formula_columns']},ensure_ascii=False))
