"""Storefront E2E for the artwork upload block against the LIVE store, via a local Selenium.

Run:  docker run -d --name selenium --rm -p 127.0.0.1:4444:4444 --shm-size=2g selenium/standalone-chromium
      python3 tests/make_test_png.py && docker cp mcgt-e2e-test.png selenium:/tmp/
      python3 tests/storefront_e2e.py
Leaves one test upload in pending/ (the backend deletes it after ~60 min). Clears the cart.
"""
import base64, json, sys, time
import requests

WD = "http://127.0.0.1:4444"
SHOP = "https://mcgtltd.com"
UA = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

caps = {"capabilities": {"alwaysMatch": {"browserName": "chrome", "goog:chromeOptions": {
    "args": ["--window-size=1280,1600", f"--user-agent={UA}",
             "--disable-blink-features=AutomationControlled"],
    "excludeSwitches": ["enable-automation"]}}}}
sid = requests.post(f"{WD}/session", json=caps).json()["value"]["sessionId"]
S = f"{WD}/session/{sid}"


def cmd(method, path, body=None):
    r = requests.request(method, S + path, json=body if body is not None else ({} if method == "POST" else None))
    v = r.json().get("value")
    if r.status_code >= 400:
        raise RuntimeError(f"{path}: {v}")
    return v


def js(script, *args):
    return cmd("POST", "/execute/sync", {"script": script, "args": list(args)})


def ajs(script, *args):
    return cmd("POST", "/execute/async", {"script": script, "args": list(args)})


def go(url):
    cmd("POST", "/url", {"url": url})
    for _ in range(40):                          # wait out "Verifying your connection..."
        if "Verifying" not in (cmd("GET", "/title") or ""):
            break
        time.sleep(1)
    time.sleep(2)
    return cmd("GET", "/title")


def shot(name):
    open(name, "wb").write(base64.b64decode(cmd("GET", "/screenshot")))


def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    return c


def el(css):
    return cmd("POST", "/element", {"using": "css selector", "value": css})["element-6066-11e4-a52e-4f735466cecf"]


fails = 0
try:
    for attempt in range(8):                     # wait for the new extension build on the CDN
        t = go(f"{SHOP}/products/your-design-t-shirt")
        src = ajs("var s=[...document.scripts].find(x=>/artwork-upload\\.js/.test(x.src));"
                  "var cb=arguments[arguments.length-1];if(!s)return cb('');"
                  "fetch(s.src).then(r=>r.text()).then(cb)")
        if "replace(/\\/+$/, '') + '/apps/mcgt-artwork'" in src:
            break
        print("old extension build still served, waiting…")
        time.sleep(20)
    print("title:", t)
    fails += not ok("replace(/\\/+$/, '') + '/apps/mcgt-artwork'" in src, "page serves the fixed extension build")
    fails += not ok(js("return !!document.querySelector('.mcgt-artwork')"), "upload block renders on tagged product")
    fails += not ok(js("var r=document.querySelector('.mcgt-artwork');return !!(r && document.getElementById(r.dataset.formId))"),
                    "block found the Horizon add-to-cart form")
    fails += not ok("£30" in js("return document.body.innerText"), "price £30 shown")
    js("document.querySelector('.mcgt-artwork').scrollIntoView({block:'center'})")
    shot("1-product.png")

    ajs("fetch('/cart/clear.js',{method:'POST'}).then(()=>arguments[arguments.length-1]())")
    # Add to cart without artwork → must be blocked
    js("document.querySelector('[id^=BuyButtons-ProductForm-] [type=submit]').click()")
    time.sleep(3)
    err = js("var e=document.querySelector('.mcgt-artwork__error');return e && !e.hidden ? e.textContent : ''")
    cnt = ajs("fetch('/cart.js').then(r=>r.json()).then(c=>arguments[arguments.length-1](c.item_count))")
    fails += not ok(bool(err) and cnt == 0, f"add-to-cart blocked without upload (msg={err!r}, cart={cnt})")
    shot("2-blocked.png")

    # Upload
    cmd("POST", f"/element/{el('.mcgt-artwork__file')}/value", {"text": "/tmp/mcgt-e2e-test.png"})
    status = ""
    for _ in range(30):
        status = js("return document.querySelector('.mcgt-artwork__status').textContent")
        if "Uploaded" in status or js("return !document.querySelector('.mcgt-artwork__error').hidden"):
            break
        time.sleep(1)
    upload_id = js("return document.querySelector('.mcgt-artwork__prop-id').value")
    fails += not ok("Uploaded" in status and len(upload_id) == 32, f"upload completed (status={status!r}, id={upload_id})")
    shot("3-uploaded.png")

    # Add to cart → properties on the line
    js("document.querySelector('[id^=BuyButtons-ProductForm-] [type=submit]').click()")
    time.sleep(4)
    cart = ajs("fetch('/cart.js').then(r=>r.json()).then(c=>arguments[arguments.length-1](c))")
    line = (cart.get("items") or [{}])[0]
    props = line.get("properties") or {}
    fails += not ok(props.get("_artwork_id") == upload_id and props.get("Artwork") == "mcgt-e2e-test.png"
                    and props.get("_artwork_required") == "1",
                    f"cart line carries artwork props: {props} ({line.get('title')} {line.get('variant_title')})")
    shot("4-cart.png")
    ajs("fetch('/cart/clear.js',{method:'POST'}).then(()=>arguments[arguments.length-1]())")

    # An untagged product must not show the block
    go(f"{SHOP}/products/short-sleeve-graphic-tee")
    fails += not ok(not js("return !!document.querySelector('.mcgt-artwork')"), "no upload block on untagged product")
    print("UPLOAD_ID", upload_id)
finally:
    requests.delete(S)
print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
