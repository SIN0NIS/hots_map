# -*- coding: utf-8 -*-
"""개발용 정적 서버 — 캐시를 끈다.

python -m http.server 는 Cache-Control 을 안 붙여서 브라우저가 예전 js/css 를
계속 쓴다 (고쳐도 화면이 안 바뀐다). 여기서는 no-store 를 붙여 항상 새로 받게 한다.

    python tools/devserver.py [포트]        기본 8123
"""
import functools
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):        # 요청마다 찍히는 줄을 줄인다
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    handler = functools.partial(NoCache, directory=ROOT)
    print(f"http://localhost:{port}/  (Ctrl+C 로 중지)")
    # 단일 스레드로 돌리면 브라우저의 병렬 요청이 줄줄이 밀려 페이지가 멈춘 것처럼 보인다
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
