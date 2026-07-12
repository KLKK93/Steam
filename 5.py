"""
NexusGames - Desktop WebView Launcher
Mo cua so desktop (webview) hien thi website https://steam-snowy.vercel.app/
Khong co thanh dia chi, giong app desktop. Inject token de unlock web (gate).
Auto can bang kich thuoc cua so theo moi do phan giai / may (dung workarea).
"""
import ctypes
try:
    ctypes.windll.user32.ShowWindow(ctypes.windll.kernel32.GetConsoleWindow(), 0)
except: pass

import secrets
import threading
import webview

WEB_URL = 'https://steam-snowy.vercel.app/'
WIN_TITLE = 'NexusGames'

# Token bi mat: 32 ky tu hex. Webview inject vao page de unlock web (gate).
# Browser truy cap truc tiep khong co token -> lock screen.
NEXUS_TOKEN = secrets.token_hex(16)  # 32 ky tu


def set_dpi_aware():
    # Giup kich thuoc cua so dung tren man 4K / Windows scaling (125%, 150%...)
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
    except:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except: pass


def get_workarea():
    # Lay vung lam viec (khong tinh taskbar) -> cua so can chinh theo khu vuc nay
    rect = ctypes.wintypes.RECT()
    SPI_GETWORKAREA = 0x0030
    ctypes.windll.user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(rect), 0)
    return rect.right - rect.left, rect.bottom - rect.top


def window_geometry():
    set_dpi_aware()
    try:
        w, h = get_workarea()
    except:
        w, h = 1920, 1080
    # Cua so = 87% workarea, can giua. min_size de khong nho qua.
    win_w = int(w * 0.87)
    win_h = int(h * 0.87)
    x = int((w - win_w) / 2)
    y = int((h - win_h) / 2)
    return win_w, win_h, x, y


def inject_token(window):
    # Inject token vao window cua page. Lap lai moi 150ms trong 3s de
    # chac chan duoc set ngay khi page load xong (race condition).
    js = f"window.__NEXUS_TOKEN = '{NEXUS_TOKEN}';"
    for _ in range(20):
        try:
            window.evaluate_js(js)
        except:
            pass
        import time
        time.sleep(0.15)


def on_loaded(window):
    # Event 'loaded' fire khi page load xong -> bat dau inject token
    threading.Thread(target=inject_token, args=(window,), daemon=True).start()


def main():
    import os
    win_w, win_h, x, y = window_geometry()
    window = webview.create_window(
        WIN_TITLE,
        WEB_URL,
        width=win_w,
        height=win_h,
        x=x,
        y=y,
        min_size=(1100, 680),
        resizable=True,
        background_color='#111317',
    )
    window.events.loaded += lambda: on_loaded(window)
    
    # Thiết lập thư mục lưu trữ cache, cookies, localstorage
    appdata = os.environ.get('APPDATA')
    if appdata:
        storage_dir = os.path.join(appdata, 'NexusGamesData')
    else:
        storage_dir = os.path.expanduser('~/NexusGamesData')
        
    try:
        os.makedirs(storage_dir, exist_ok=True)
    except:
        storage_dir = None
        
    webview.start(private_mode=False, storage_path=storage_dir)


if __name__ == "__main__":
    main()
