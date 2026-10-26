import http.server, sys, os, urllib.parse
ROOT, OUT = sys.argv[1], sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def do_POST(self):
        name = os.path.basename(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)["name"][0])
        data = self.rfile.read(int(self.headers["Content-Length"]))
        open(os.path.join(OUT, name), "wb").write(data)
        self.send_response(204); self.end_headers()
http.server.ThreadingHTTPServer(("127.0.0.1", 8765), H).serve_forever()
