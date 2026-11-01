"""Copy the recovered PowerScript into the rebuild repository with vendor secrets removed.

usage: python -I redact.py <recovered/scripts dir> <out dir>

What is removed (values are never printed, never stored in this repository, only counted):
  * string literals assigned to the database password variable `gs_password`
  * the fixed text fragments the original used to build SQL Server backup / media passwords: in every line that sets a
    PASSWORD / MEDIAPASSWORD the literal words are replaced (recognised by the statement, not by the words themselves)
After copying, the output is scanned for every secret value that was found in the input; any hit aborts the run.
"""
import os, re, sys, glob, hashlib, json

ASSIGN = re.compile(r'(\bgs_password\s*=\s*)"([^"]+)"', re.I)
# lines that set a backup / media password: "...MEDIAPASSWORD='xyz" + lower(ls_server) ..., "Password='xyz" + ...
PWLINE = re.compile(r'media\s*password|password\s*=\s*\'', re.I)
LITERAL_AFTER_QUOTE = re.compile(r'''(["']')([A-Za-z]{3,})(")''')          # "'word"
LITERAL_IN_ASSIGN = re.compile(r"""(password\s*=\s*'?)([A-Za-z]{3,})(")""", re.I)  # Password='word"


def main(src, dst):
    secrets = set()
    n_files = n_assign = n_frag = 0
    for f in sorted(glob.glob(os.path.join(src, '*', '*.pbs'))):
        text = open(f, encoding='utf-8', errors='replace').read()
        out_lines = []
        for line in text.split('\n'):
            m = ASSIGN.search(line)
            if m:
                secrets.add(m.group(2))
                n_assign += 1
                line = ASSIGN.sub(lambda mm: mm.group(1) + '""', line)
            if PWLINE.search(line):
                def lit(mm):
                    nonlocal n_frag
                    secrets.add(mm.group(2))
                    n_frag += 1
                    return mm.group(1) + 'REDACTED' + mm.group(3)
                line = LITERAL_AFTER_QUOTE.sub(lit, line)
                line = LITERAL_IN_ASSIGN.sub(lit, line)
            out_lines.append(line)
        rel = os.path.relpath(f, src)
        os.makedirs(os.path.join(dst, os.path.dirname(rel)), exist_ok=True)
        open(os.path.join(dst, rel), 'w', encoding='utf-8', newline='\n').write('\n'.join(out_lines))
        n_files += 1
    bad = []
    for f in glob.glob(os.path.join(dst, '*', '*.pbs')):
        t = open(f, encoding='utf-8', errors='replace').read().lower()
        for s in secrets:
            if len(s) >= 4 and s.lower() in t and s.upper() != 'REDACTED':
                bad.append((os.path.relpath(f, dst), hashlib.sha256(s.encode()).hexdigest()[:8]))
    if bad:
        print('LEAK DETECTED in', bad[:5])
        sys.exit(1)
    json.dump({'files': n_files, 'password_assignments_cleared': n_assign, 'backup_fragments_replaced': n_frag}, open(os.path.join(dst, '_redaction.json'), 'w'))
    print('files', n_files, 'cleared assignments', n_assign, 'fragments replaced', n_frag, 'leak scan clean')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
