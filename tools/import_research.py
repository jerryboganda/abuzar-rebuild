"""One-time (re-runnable) import of the reverse-engineering results into data/src of this repository.

usage: python -I import_research.py <research project root> <rebuild root>

  scripts  <- recovered/scripts           (vendor secrets removed by redact.py)
  objects  <- recovered/objects           (window / menu / user-object / structure definitions, minified)
  names    <- recovered/pcode_names       (global variable table and types of the application object)
  dw       <- built separately by build_dw_bundle.py
"""
import os, sys, json, glob, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))


def main(src, dst):
    data = os.path.join(dst, 'data', 'src')
    # 1. scripts with secrets removed
    subprocess.check_call([sys.executable, '-I', os.path.join(HERE, 'redact.py'), os.path.join(src, 'recovered', 'scripts'), os.path.join(data, 'scripts')])
    # 2. object definitions
    n = 0
    for f in glob.glob(os.path.join(src, 'recovered', 'objects', '*', '*', '*.json')):
        rel = os.path.relpath(f, os.path.join(src, 'recovered', 'objects'))
        out = os.path.join(data, 'objects', rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        d = json.load(open(f, encoding='utf-8'))
        json.dump(d, open(out, 'w', encoding='utf-8', newline='\n'), separators=(',', ':'), ensure_ascii=False)
        n += 1
    # 3. names
    nm = os.path.join(src, 'recovered', 'pcode_names')
    shared = json.load(open(os.path.join(nm, 'shared_vars.json'), encoding='utf-8'))
    gtypes = json.load(open(os.path.join(nm, 'global_types.json'), encoding='utf-8'))
    os.makedirs(os.path.join(data, 'names'), exist_ok=True)
    json.dump({'sharedVars': {'traderappv1': shared['traderappv1']}, 'globalTypes': gtypes},
              open(os.path.join(data, 'names', 'names.json'), 'w', encoding='utf-8', newline='\n'), separators=(',', ':'))
    print('objects', n, 'names ok')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
