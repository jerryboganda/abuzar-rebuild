"""Decode the QR codes written by web/tools/qr-check.ts with OpenCV and compare with the encoded text.
usage: python tools/qr_verify.py <dir>      (needs opencv-python-headless)"""
import json, os, sys
import cv2

d = sys.argv[1]
cases = json.load(open(os.path.join(d, 'cases.json'), encoding='utf-8'))
det = cv2.QRCodeDetector()
bad = 0
for c in cases:
    img = cv2.imread(os.path.join(d, c['file']))
    text, pts, _ = det.detectAndDecode(img)
    if text != c['text']:
        bad += 1
        print('MISMATCH', c['file'], 'version', c['version'], 'ecl', c['ecl'], 'decoded %d chars, expected %d' % (len(text), len(c['text'])))
print('decoded %d of %d' % (len(cases) - bad, len(cases)))
sys.exit(1 if bad else 0)
