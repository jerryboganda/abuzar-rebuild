"""Statistics over the recovered DataWindow definitions (scope of the DataWindow engine).
usage: python -I dw_stats.py <datawindows_json dir> <out json>"""
import sys, os, re, json, glob, collections

FUNC = re.compile(r'\b([a-z_][a-z_0-9]*)\s*\(', re.I)


def main(src, out):
    c = collections.Counter
    st = {'files': 0, 'processing': c(), 'objtypes': c(), 'edit_style': c(), 'coltypes': c(), 'funcs': c(), 'band': c(),
          'objprops': collections.defaultdict(c), 'expr_props': c(), 'fmt': c(), 'groups': 0, 'with_args': 0, 'retrieve_pbselect': 0,
          'retrieve_sql': 0, 'units': c(), 'extras': c(), 'update_tables': 0}
    exprs = collections.defaultdict(list)
    for f in glob.glob(os.path.join(src, '*', '*.json')):
        d = json.load(open(f, encoding='utf-8'))
        st['files'] += 1
        dw = d.get('datawindow', {})
        st['processing'][dw.get('processing')] += 1
        st['units'][dw.get('units')] += 1
        for b in d.get('bands', {}):
            st['band'][b] += 1
        t = d.get('table') or {}
        for col in t.get('columns', []):
            st['coltypes'][re.sub(r'\(.*', '', col.get('type', '?'))] += 1
        r = t.get('retrieve') or ''
        if r.lstrip().upper().startswith('PBSELECT'):
            st['retrieve_pbselect'] += 1
        elif r.strip():
            st['retrieve_sql'] += 1
        if t.get('update'):
            st['update_tables'] += 1
        for o in d.get('objects', []):
            ty = o.get('type', '?')
            st['objtypes'][ty] += 1
            for k, v in o.items():
                st['objprops'][ty][k] += 1
                if isinstance(v, str) and (v.startswith('~t') or ('(' in v and k in ('expression', 'visible', 'color', 'background.color', 'height', 'x', 'y', 'width', 'border', 'font.weight', 'font.height', 'alignment', 'protect', 'pointer', 'format', 'text') and ty != 'text' and k != 'text')):
                    st['expr_props'][k] += 1
                if k == 'expression' or (isinstance(v, str) and v.startswith('~t')):
                    for m in FUNC.finditer(v):
                        st['funcs'][m.group(1).lower()] += 1
            if ty == 'column':
                st['edit_style'][o.get('edit.style', o.get('edit', 'edit'))] += 1
            if 'format' in o:
                st['fmt'][o['format']] += 1
    st['objprops'] = {k: dict(v.most_common(40)) for k, v in st['objprops'].items()}
    for k in ('processing', 'objtypes', 'edit_style', 'coltypes', 'band', 'units'):
        st[k] = dict(st[k].most_common(40))
    st['funcs'] = dict(st['funcs'].most_common(120))
    st['expr_props'] = dict(st['expr_props'].most_common(30))
    st['fmt'] = dict(st['fmt'].most_common(40))
    json.dump(st, open(out, 'w', encoding='utf-8'), indent=1)
    print('done', st['files'])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
