#!/usr/bin/env python3
"""Generate a voiceover with Inworld TTS (non-streaming, batch) and save word timings.

Usage:  python3 tools/tts-inworld.py <script.txt> <out.mp3> [--voice Sarah] [--rate 1] [--mode BALANCED]

The API key is read from the INWORLD_API_KEY environment variable, or from a line
`INWORLD_API_KEY=...` in qr-menu/.env.local (git-ignored). It is never printed.
Writes <out.mp3> and <out>.words.json ([{w, s, e}] in seconds, for timing the video).
"""
import argparse, base64, json, os, pathlib, sys, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = 'https://api.inworld.ai/tts/v1/voice'


def api_key():
    key = os.environ.get('INWORLD_API_KEY', '').strip()
    env = ROOT / '.env.local'
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.strip().startswith('INWORLD_API_KEY='):
                key = line.split('=', 1)[1].strip().strip('"\'')
    if not key:
        sys.exit('INWORLD_API_KEY is not set. Add it to the environment or to qr-menu/.env.local.')
    return key


def words_from(info):
    """Normalise Inworld's wordAlignment into [{w, s, e}]."""
    wa = (info or {}).get('wordAlignment') or {}
    words = wa.get('words') or []
    starts = wa.get('wordStartTimeSeconds') or []
    ends = wa.get('wordEndTimeSeconds') or []
    return [{'w': w, 's': round(float(s), 3), 'e': round(float(e), 3)} for w, s, e in zip(words, starts, ends)]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('script'); p.add_argument('out')
    p.add_argument('--voice', default='Sarah'); p.add_argument('--rate', type=float, default=1.0)
    p.add_argument('--mode', default='BALANCED', choices=['STABLE', 'BALANCED', 'CREATIVE'])
    a = p.parse_args()
    text = pathlib.Path(a.script).read_text().strip()
    body = {
        'text': text, 'voiceId': a.voice, 'modelId': 'inworld-tts-2', 'timestampType': 'WORD',
        'audioConfig': {'speakingRate': a.rate}, 'deliveryMode': a.mode, 'language': 'AUTO',
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method='POST', headers={
        'Authorization': f'Basic {api_key()}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            res = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f'Inworld error {e.code}: {e.read().decode()[:400]}')
    out = pathlib.Path(a.out)
    out.write_bytes(base64.b64decode(res['audioContent']))
    words = words_from(res.get('timestampInfo'))
    out.with_suffix('.words.json').write_text(json.dumps(words, indent=1))
    print(f'Saved {out} ({out.stat().st_size // 1024} KB), {len(words)} timed words')


if __name__ == '__main__':
    main()
