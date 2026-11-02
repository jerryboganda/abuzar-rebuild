"""Collect the numbers of the CI end-to-end job (real server + PostgreSQL) into docs/ci-results.json.
usage: python -I tools/ci_results.py <job log (ANSI stripped)> <run id> <commit sha> [out json]
The numbers are parsed from the tools' own output lines; nothing is typed in by hand."""
import json, re, sys

log = open(sys.argv[1], encoding='utf-8', errors='replace').read()
run, sha = sys.argv[2], sys.argv[3]
out = sys.argv[4] if len(sys.argv) > 4 else 'docs/ci-results.json'


def pair(pattern):
    m = re.search(pattern, log)
    return {'ok': int(m.group(1)), 'of': int(m.group(2))} if m else None


res = {
    'run': run,
    'commit': sha,
    'embedded_statements': pair(r'embedded statements executed: (\d+) of (\d+)'),
    'datawindow_retrieves': pair(r'DataWindows executed: (\d+) of (\d+)'),
    'procedures': pair(r'procedures executed: (\d+) of (\d+)'),
}
res['datawindow_evaluation'] = pair(r'DataWindows evaluated with synthetic rows: (\d+) of (\d+)')
m = re.search(r'windows tried (\d+)\s+opened without runtime error (\d+)', log)
res['windows'] = {'ok': int(m.group(2)), 'of': int(m.group(1))} if m else None
m = re.search(r'start-up (completed|FAILED)(.*)', log)
res['startup'] = (m.group(1) + m.group(2)).strip()[:300] if m else None
m = re.search(r'login result (\S+)\s+user code (\S+)', log)
res['login'] = {'result': m.group(1), 'user_code': m.group(2)} if m else None
m = re.search(r'main window: menu bar \[([^\]]*)\], (\d+) toolbar buttons', log, re.M)
m2 = re.search(r'sample of (\d+) of (\d+) windows.*?: (\d+) opened in the DOM user interface, (\d+) raised an exception', log)
m3 = re.search(r'browser errors \(.*?\): (\d+)', log)
res['browser'] = {'menu_bar': m.group(1) if m else None, 'toolbar_buttons': int(m.group(2)) if m else None,
                  'sample': int(m2.group(1)) if m2 else None, 'opened': int(m2.group(3)) if m2 else None, 'exceptions': int(m2.group(4)) if m2 else None,
                  'errors': int(m3.group(1)) if m3 else None}
m = re.search(r'^main menu: (\d+) of (\d+) items visible; top level: (\d+) of (\d+)', log, re.M)
res['main_menu'] = {'visible': int(m.group(1)), 'of': int(m.group(2)), 'top_visible': int(m.group(3)), 'top': int(m.group(4))} if m else None
json.dump(res, open(out, 'w', encoding='utf-8', newline='\n'), indent=1)
print(json.dumps(res))
