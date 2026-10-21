#!/usr/bin/env python3
"""
礼单簿 · 引导页截图一键重生成

流程：复刻源 HTML（docs/screens/guide-assets-src/*.html）
  → 无头 Chromium（CDP，390 逻辑宽、deviceScaleFactor=2、整页截图）
  → 源图存档（docs/screens/guide-assets-src/*.png）
  → PIL 压缩（宽 750 起、256 色量化；超限逐步收窄至 600）
  → 成品落位分包（miniprogram/packages/guide/guide-*.png，单张 ≤150KB，超限报错退出）
  → 引导成品存档图（docs/screens/guide-new-1/2/3.png，整屏含配文与按钮）

页面改版后：先改复刻源 HTML（数据口径见各 HTML 头注释），再跑本脚本即可。
用法：python3 tools/regen-guide-shots/regen.py
依赖：/opt/meta-chromium/chrome、python3 的 websocket-client 与 PIL。
"""
import base64
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from PIL import Image
import websocket

ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT / "docs" / "screens" / "guide-assets-src"
PKG_DIR = ROOT / "miniprogram" / "packages" / "guide"
ARCHIVE_DIR = ROOT / "docs" / "screens"
CHROME = "/opt/meta-chromium/chrome"
PORT = 9223
LIMIT = 150 * 1024

# (复刻源文件名, 分包成品名, 配文) —— 配文与 pages/guide/guide.js 保持一致
SHOTS = [
    ("receive-records", "guide-receive.png", "收到的礼，一笔笔记清楚"),
    ("gifts", "guide-gifts.png", "送出的礼，随时翻看"),
    ("timeline", "guide-timeline.png", "人情往来，一目了然"),
]


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=30)
        self.seq = 0

    def call(self, method, **params):
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})


def wait_cdp_ready():
    for _ in range(60):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=2) as r:
                return json.loads(r.read())["webSocketDebuggerUrl"]
        except Exception:
            time.sleep(0.5)
    raise RuntimeError("Chromium 调试端口未就绪")


class Page:
    def __init__(self, browser):
        self.browser = browser
        self.seq = 1000
        tid = browser.call("Target.createTarget", url="about:blank")["targetId"]
        browser.ws.settimeout(15)
        browser.seq += 1
        browser.ws.send(json.dumps({"id": browser.seq, "method": "Target.attachToTarget",
                                    "params": {"targetId": tid, "flatten": True}}))
        while True:
            msg = json.loads(browser.ws.recv())
            if msg.get("method") == "Target.attachedToTarget":
                self.session = msg["params"]["sessionId"]
                break

    def call(self, method, **params):
        self.seq += 1
        self.browser.ws.send(json.dumps({"id": self.seq, "sessionId": self.session,
                                         "method": method, "params": params}))
        while True:
            msg = json.loads(self.browser.ws.recv())
            if msg.get("id") == self.seq:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def evaluate(self, expr, await_promise=False):
        r = self.call("Runtime.evaluate", expression=expr,
                      awaitPromise=await_promise, returnByValue=True)
        return r.get("result", {}).get("value")


def shoot(page, url, width, height, out_path):
    page.call("Page.enable")
    page.call("Emulation.setDeviceMetricsOverride", width=width, height=height,
              deviceScaleFactor=2, mobile=False)
    page.call("Page.navigate", url=url)
    for _ in range(40):
        if page.evaluate("document.readyState") == "complete":
            break
        time.sleep(0.25)
    page.evaluate("Promise.all([...document.images].map(i => i.complete ? 1 : i.decode().catch(()=>{})))",
                  await_promise=True)
    time.sleep(0.2)
    full_h = int(page.evaluate("document.body.scrollHeight"))
    if full_h != height:
        page.call("Emulation.setDeviceMetricsOverride", width=width, height=full_h,
                  deviceScaleFactor=2, mobile=False)
        time.sleep(0.2)
    shot = page.call("Page.captureScreenshot", format="png", captureBeyondViewport=True)
    out_path.write_bytes(base64.b64decode(shot["data"]))
    return full_h


def compress(src_png, dest_png):
    """宽 750 起量化压缩，超限逐步收窄；返回 (字节数, 宽度)；到 600 仍超限返回 None"""
    im = Image.open(src_png).convert("RGB")
    width = 750
    while True:
        w, h = im.size
        resized = im.resize((width, round(h * width / w)), Image.LANCZOS)
        q = resized.quantize(colors=256, method=Image.MEDIANCUT)
        q.save(dest_png, optimize=True)
        size = dest_png.stat().st_size
        if size <= LIMIT or width <= 600:
            return (size, width) if size <= LIMIT else None
        width -= 50


GUIDE_SCREEN_TMPL = """<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ width:390px; height:844px; background:#F6F6F6; font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; color:#333; position:relative; overflow:hidden; }}
.skip {{ position:absolute; top:56px; right:16px; font-size:13px; color:#999; padding:6px 10px; z-index:5; }}
.screen {{ display:flex; flex-direction:column; align-items:center; padding:64px 24px 0; }}
.shot-frame {{ width:300px; height:470px; border-radius:12px; overflow:hidden; background:#fff; border:1px solid #E8DFC9; box-shadow:0 6px 18px rgba(0,0,0,.06); }}
.shot-frame img {{ width:300px; display:block; }}
.g-title {{ font-family:"Songti SC","STSong","Noto Serif CJK SC","SimSun",serif; font-size:21px; font-weight:600; margin-top:30px; text-align:center; }}
.dots {{ display:flex; justify-content:center; gap:7px; margin-top:26px; }}
.dot {{ width:7px; height:7px; border-radius:50%; background:#DDD; }}
.dot.on {{ background:#F0575A; }}
.g-btn {{ margin:20px 24px 0; height:56px; line-height:56px; background:#F0575A; color:#fff; text-align:center; font-size:17px; border-radius:28px; }}
</style></head><body>
<div class="skip">{skip}</div>
<div class="screen">
  <div class="shot-frame"><img src="{img}"></div>
  <div class="g-title">{caption}</div>
</div>
<div class="dots">{dots}</div>
<div class="g-btn">{btn}</div>
</body></html>
"""


def main():
    PKG_DIR.mkdir(parents=True, exist_ok=True)
    profile = tempfile.mkdtemp(prefix="guide-shots-chrome-")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*", "--no-sandbox",
         f"--user-data-dir={profile}", "--hide-scrollbars", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    failures = []
    try:
        browser = CDP(wait_cdp_ready())
        for idx, (name, pkg_name, caption) in enumerate(SHOTS):
            page = Page(browser)
            src_html = SRC_DIR / f"{name}.html"
            src_png = SRC_DIR / f"{name}.png"
            h = shoot(page, src_html.as_uri(), 390, 844, src_png)
            dest = PKG_DIR / pkg_name
            got = compress(src_png, dest)
            if got is None:
                failures.append(f"{pkg_name}：收窄到 600 宽仍超过 150KB")
                print(f"[FAIL] {pkg_name} 超过 150KB 上限")
                continue
            size, width = got
            print(f"[OK] {pkg_name}: {size} 字节（{size/1024:.1f} KB，宽 {width}px，源图高 {h}px）达标 ≤150KB")

            # 引导成品存档图（整屏含配文/按钮，390×844）
            dots = "".join(f'<div class="dot{" on" if i == idx else ""}"></div>' for i in range(3))
            html = GUIDE_SCREEN_TMPL.format(
                skip="跳过", img=(PKG_DIR / pkg_name).as_uri(), caption=caption,
                dots=dots, btn="开始使用" if idx == 2 else "下一步")
            tmp_html = Path(profile) / f"guide-screen-{idx+1}.html"
            tmp_html.write_text(html, encoding="utf-8")
            page2 = Page(browser)
            shoot(page2, tmp_html.as_uri(), 390, 844, ARCHIVE_DIR / f"guide-new-{idx+1}.png")
            print(f"[OK] docs/screens/guide-new-{idx+1}.png 已生成")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    if failures:
        print("\n".join(failures), file=sys.stderr)
        sys.exit(1)
    print("全部完成：三张成品均 ≤150KB 并已落位 miniprogram/packages/guide/")


if __name__ == "__main__":
    main()
