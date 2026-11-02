"""Pack the recovered DataWindow definitions into one gzip-compressed JSON bundle per library.
usage: python -I build_dw_bundle.py <datawindows_json dir> <out dir>
Dropped as irrelevant to the rebuild: the `extras` section (HTML / XHTML generation defaults) and `html.*` object properties."""
import sys, os, json, gzip, glob


def slim(d):
    d.pop('extras', None)
    for o in d.get('objects', []):
        for k in [k for k in o if k.startswith('html.')]:
            del o[k]
    return d


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    total_in = total_out = n = 0
    index = {}
    for libdir in sorted(glob.glob(os.path.join(src, '*'))):
        if not os.path.isdir(libdir):
            continue
        lib = os.path.basename(libdir)
        bundle = {}
        for f in sorted(glob.glob(os.path.join(libdir, '*.json'))):
            name = os.path.splitext(os.path.basename(f))[0].lower()
            total_in += os.path.getsize(f)
            bundle[name] = slim(json.load(open(f, encoding='utf-8')))
            index[name] = lib
            n += 1
        if not bundle:
            continue
        data = json.dumps(bundle, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        with gzip.open(os.path.join(dst, lib + '.json.gz'), 'wb', compresslevel=9) as fh:
            fh.write(data)
        total_out += os.path.getsize(os.path.join(dst, lib + '.json.gz'))
    json.dump(index, open(os.path.join(dst, '_index.json'), 'w'), separators=(',', ':'))
    print('datawindows', n, 'input MB', total_in // 1048576, 'bundle MB', total_out // 1048576)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
