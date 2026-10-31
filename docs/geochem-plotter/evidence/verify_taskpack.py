"""Validate task-pack links, factual baselines, math and source integrity."""
from pathlib import Path
import ast
import csv
from decimal import Decimal
import hashlib
import json
import math
import re

ROOT = Path(__file__).resolve().parents[3]
PACK = ROOT/'docs/geochem-plotter'
docs = sorted(PACK.glob('*.md')) + [ROOT/'科研绘图工具_任务总入口.md',ROOT/'GeoPlot_科研绘图工具_正式任务书_v2.md']
failures = []
for path in docs:
    content = path.read_text(encoding='utf-8')
    if '\ufffd' in content:
        failures.append(f'replacement character: {path.name}')
    if re.search(r'\b(?:TODO|TBD)\b',content):
        failures.append(f'placeholder: {path.name}')
    if len(re.findall(r'^```',content,re.M)) % 2:
        failures.append(f'unbalanced fence: {path.name}')
    for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)',content):
        if link.startswith(('http:','https:','#')):
            continue
        target = link.split('#')[0].strip('<>')
        if target and not (path.parent/target).exists():
            failures.append(f'missing relative link {path.name}: {target}')
    for block in re.findall(r'```json\s*\n(.*?)\n```', content, re.S):
        try: json.loads(block)
        except Exception as exc: failures.append(f'invalid JSON example {path.name}: {exc}')
for path in (PACK/'evidence').glob('*.py'):
    ast.parse(path.read_text(encoding='utf-8'))
for path in (PACK/'evidence').glob('*.json'):
    json.loads(path.read_text(encoding='utf-8'))
profile=json.loads((PACK/'evidence/workbook_profile.json').read_text(encoding='utf-8'))
diag=json.loads((PACK/'evidence/workbook_diagnostics.json').read_text(encoding='utf-8'))
source=ROOT/profile['file']
sha=hashlib.sha256(source.read_bytes()).hexdigest()
assert sha==profile['sha256']==diag['sha256']
assert sum(s['max_row']-1 for s in profile['sheets'] if s['sheet']!='Normalization value')==45318
assert sum(s['formula_count'] for s in profile['sheets'])==25535
assert sum(s['cached_errors_count'] for s in diag['sheets'].values())==3003
assert len(diag['apollo_74235'])==14
assert sum(str(x['sample'])=='74235' for x in diag['apollo_74235'])==4
assert diag['trace_overlap']['matched_rows']==535
oracles=json.loads((PACK/'evidence/numeric_oracles.json').read_text(encoding='utf-8'))
checked=[]
for case in oracles['cases']:
    if case.get('expected') is None or case['id']=='D03': continue
    op=case['operation']
    if op=='normalize':
        value=case['value']/(1000 if case['unit']=='ppb' else 1)/case['reference']
    elif op=='ratio': value=case['a']/case['b']
    elif op=='normalized_ratio': value=(case['a']/case['a_reference'])/(case['b']/case['b_reference'])
    elif op=='normalized_absolute_uncertainty': value=case['uncertainty']/case['reference']
    elif op=='independent_ratio_uncertainty':
        value=abs(case['a']/case['b'])*math.sqrt((case['ua']/case['a'])**2+(case['ub']/case['b'])**2)
    elif op=='eu_anomaly_geometric': value=case['eu_n']/math.sqrt(case['sm_n']*case['gd_n'])
    else: raise ValueError(op)
    assert math.isclose(value,case['expected'],rel_tol=1e-10,abs_tol=1e-12),case['id']
    checked.append(case['id'])
q=(PACK/'06_QODER_后端与计算任务书.md').read_text(encoding='utf-8')
t=(PACK/'07_TRAE_界面与交互任务书.md').read_text(encoding='utf-8')
a=(PACK/'08_验收用例与交付门槛.md').read_text(encoding='utf-8')
qids=re.findall(r'^## (Q\d+) /',q,re.M)
tids=re.findall(r'^## (T\d+) /',t,re.M)
extra=(PACK/'15_v2接口与任务增补.md').read_text(encoding='utf-8')
v=(PACK/'16_v2交互导出启动验收.md').read_text(encoding='utf-8')
qids+=re.findall(r'^## (Q\d+) /',extra,re.M)
tids+=re.findall(r'^## (T\d+) /',extra,re.M)
cases=re.findall(r'^\| ([A-E]\d+) \| (P[01]) \|',a,re.M)+re.findall(r'^\| (V\d+) \| (P[01]) \|',v,re.M)
assert qids==[f'Q{i:02d}' for i in range(1,13)]
assert tids==[f'T{i:02d}' for i in range(1,12)]
assert len(cases)==len(set(cases))==87
assert sum(p=='P0' for _,p in cases)==86
assert [c for c,p in cases if p=='P1']==['C16']
checklist=(PACK/'11_总任务清单.md').read_text(encoding='utf-8')
assert set(re.findall(r'^\| \[ \] \| ([QT]\d+) \|',checklist,re.M))==set(qids+tids)
refs={}
ref_hashes={}
for name,expected_count in [('Chondrite_MS95',14),('PM_SM89',27)]:
    path=PACK/f'evidence/{name}_v1.csv'
    rows=list(csv.DictReader(path.open(encoding='utf-8-sig',newline='')))
    assert len(rows)==expected_count
    assert len({r['element'] for r in rows})==expected_count
    values={}
    for r in rows:
        assert r['unit']=='ppm' and r['reference_id']==name and r['doi'].startswith('10.')
        val=Decimal(r['value'])
        assert val.is_finite() and val>0
        conversion={'ppb':Decimal('0.001'),'ppm':Decimal('1'),'wt%':Decimal('10000')}[r['source_unit']]
        assert val==Decimal(r['source_value'])*conversion
        values[r['element']]=val
    refs[name]=values
    ref_hashes[name]=hashlib.sha256(path.read_bytes()).hexdigest()
for r in diag['normalization']:
    element=re.search(r'"([A-Z][a-z]?)"',r['element_text']).group(1)
    assert refs['Chondrite_MS95'][element]==Decimal(str(r['value']))
assert list(refs['Chondrite_MS95'])=='La Ce Pr Nd Sm Eu Gd Tb Dy Ho Er Tm Yb Lu'.split()
assert list(refs['PM_SM89'])=='Cs Rb Ba Th U Nb Ta La Ce Pb Pr Sr Nd Zr Hf Sm Eu Ti Gd Tb Dy Y Ho Er Tm Yb Lu'.split()
assert Decimal('10')/Decimal('100')==Decimal('0.1')
assert (Decimal('2.37')/refs['Chondrite_MS95']['La'])/(Decimal('0.322')/refs['Chondrite_MS95']['Yb'])==5
assert 50*100/80==62.5 and (2+1)*100/80==3.75
assert abs(183/25.4*600-4323)<=1 and abs(110/25.4*600-2598)<=1
assert math.isclose(math.log10(0.1),-1) and math.log10(1000)==3
spec_blocks=[json.loads(b) for b in re.findall(r'```json\s*\n(.*?)\n```',(PACK/'05_接口与共享契约.md').read_text(encoding='utf-8'),re.S)]
spec=next(b for b in spec_blocks if 'schema_version' in b)
assert spec['schema_version']=='1.1'
style_fields={'marker_shape','marker_fill','marker_fill_color','marker_edge_color','marker_size_pt','marker_edge_width_pt','marker_alpha','line_color','line_width_pt','line_dash','line_alpha','connect'}
shapes={'circle','square','triangle_up','triangle_down','diamond','plus','cross','star','hexagon'}
for layer in spec['layers']:
    assert set(layer['style'])==style_fields
    assert layer['style']['marker_shape'] in shapes and 'analysis_style_overrides' in layer
assert set(spec['axes'])=={'x','y'} and spec['axes']['y']['scale']=='log10'
assert spec['axes']['x']['category_order']==spec['variables']['elements']
assert spec['axes']['x']['visible_categories']==spec['variables']['elements']
assert 'legend_position' not in spec['layout']
instructions=(PACK/'14_工具指令与同步开工说明_v2.md').read_text(encoding='utf-8')
blocks=re.findall(r'```text\n(.*?)\n```',instructions,re.S)
assert len(blocks)==2
for name,block in zip(['QODER_启动指令.md','TRAE_启动指令.md'],blocks):
    assert block in (PACK/name).read_text(encoding='utf-8'),f'outdated copied instructions: {name}'
main=(ROOT/'GeoPlot_科研绘图工具_正式任务书_v2.md').read_text(encoding='utf-8')
for required in ['同一交付包','已安装Python/Node','未安装Python/Node','AstroMat数据不在本次任务范围','GeoPlotLauncher.exe','启动程序','停止程序','打开绘图界面','PNG/PDF/SVG','FigureRevision','alpha=1','0.1, 5']:
    assert required in main,required
assert len(re.findall(r'^\| R\d+ \|',(PACK/'12_任务书自我核查与修订报告_v2.md').read_text(encoding='utf-8'),re.M))==21
manifest={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in docs}
repair=(PACK/'18_pyrolite绘图内核返工任务书.md').read_text(encoding='utf-8')
repair_q=re.findall(r'^### (QR\d+)：',repair,re.M)
repair_t=re.findall(r'^### (TR\d+)：',repair,re.M)
repair_cases=re.findall(r'^\| (R\d+) \|',repair,re.M)
assert repair_q==[f'QR{i:02}' for i in range(1,7)]
assert repair_t==[f'TR{i:02}' for i in range(1,4)]
assert repair_cases==[f'R{i:02}' for i in range(1,21)]
repair_blocks=re.findall(r'```text\n(.*?)\n```',repair,re.S)[-2:]
for name,block in zip(['QODER','TRAE'],repair_blocks):
    assert block in (PACK/f'{name}_pyrolite返工指令.md').read_text(encoding='utf-8')
report={'status':'PASS' if not failures else 'FAIL','taskpack_version':'2.0','schema_version':'1.1','task_date':'2026-10-28','markdown_files':len(docs),
        'qoder_tasks':qids,'trae_tasks':tids,'acceptance_cases':len(cases),
        'p0_cases':86,'p1_cases':1,'source_sha256':sha,'source_unchanged':True,
        'numeric_oracles_checked':checked,'failures':failures,
        'reference_value_counts':{name:len(vals) for name,vals in refs.items()},'reference_csv_sha256':ref_hashes,
        'v2_checks':['local links','JSON examples','23 task IDs','87 acceptance IDs','21 review defects','reference unit conversions','CI matches workbook','scatter (0.1,5)','dry TAS (62.5,3.75)','PNG dimensions','Plotly log range conversion','schema1.1 sample','copied tool instructions','dual runtime requirement'],
        'markdown_sha256':manifest,
        'repair_addendum_date':'2026-10-29','repair_target_schema':'1.2',
        'repair_tasks':repair_q+repair_t,'repair_acceptance_cases':repair_cases,
        'scope':'Documentation consistency, source baselines and arithmetic only. Application code exists; separate behavioral audit requires rework. This PASS is not application acceptance.'}
(PACK/'evidence/taskpack_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
if failures: raise SystemExit(1)
