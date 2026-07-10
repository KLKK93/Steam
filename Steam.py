import os
import urllib.request
import zipfile
import shutil
import ctypes
import sys
import ssl
import time
import concurrent.futures
import traceback
import subprocess
import msvcrt

def print_overall_progress(percent):
    if percent > 100: percent = 100
    sys.stdout.write(f"\rĐang tiến trình cài đặt... {int(percent)}% / 100%   ")
    sys.stdout.flush()

def get_steam_install_path():
    import winreg
    try:
        key_path = r"SOFTWARE\WOW6432Node\Valve\Steam"
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path) as key:
            install_path, _ = winreg.QueryValueEx(key, "InstallPath")
            return install_path
    except Exception as e1:
        try:
            key_path = r"SOFTWARE\Valve\Steam"
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path) as key:
                install_path, _ = winreg.QueryValueEx(key, "InstallPath")
                return install_path
        except Exception as e2:
            return None

def is_steam_running():
    try:
        output = subprocess.check_output('tasklist /FI "IMAGENAME eq steam.exe" /NH', shell=True).decode('utf-8', errors='ignore')
        return "steam.exe" in output.lower()
    except Exception:
        return False

def kill_steam():
    os.system("taskkill /f /im steam.exe >nul 2>&1")

def start_steam(target_dir):
    steam_exe = os.path.join(target_dir, "steam.exe")
    if os.path.exists(steam_exe):
        try:
            os.system(f'start "" "{steam_exe}"')
        except Exception as e:
            print(f"\n[LỖI] Không thể khởi động Steam: {e}")
    else:
        print(f"\n[LỖI] Không tìm thấy steam.exe tại {target_dir}")

class FastDownloader:
    def __init__(self, url, dest, num_threads=16):
        self.url = url
        self.dest = dest
        self.num_threads = num_threads
        self.total_size = 0
        self.downloaded = 0
        self.chunk_size = 1024 * 1024
        import threading
        self.lock = threading.Lock()
        
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        self.ctx = ctx
        self.headers = {'User-Agent': 'Mozilla/5.0'}
        self.error_msg = None

    def get_file_info(self):
        req = urllib.request.Request(self.url, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=10, context=self.ctx) as response:
                size = response.headers.get('Content-Length')
                if size:
                    self.total_size = int(size)
                return True if self.total_size > 0 else False
        except Exception as e:
            self.error_msg = f"Lỗi lấy dữ liệu header từ server: {e}"
            return False

    def download_chunk(self, start, end, part_num):
        part_file = f"{self.dest}.part{part_num}"
        expected_size = end - start + 1
        
        if os.path.exists(part_file) and os.path.getsize(part_file) == expected_size:
            with self.lock:
                self.downloaded += expected_size
            return True

        headers = self.headers.copy()
        headers['Range'] = f'bytes={start}-{end}'
        req = urllib.request.Request(self.url, headers=headers)
        
        last_exception = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=15, context=self.ctx) as response:
                    downloaded_this_time = 0
                    with open(part_file, 'wb') as f:
                        while True:
                            chunk = response.read(1024 * 256)
                            if not chunk:
                                break
                            f.write(chunk)
                            l = len(chunk)
                            downloaded_this_time += l
                            with self.lock:
                                self.downloaded += l 
                    
                    if downloaded_this_time == expected_size:
                        return True
                    else:
                        with self.lock:
                            self.downloaded -= downloaded_this_time
                        last_exception = Exception(f"File tải thiếu ({downloaded_this_time}/{expected_size})")
            except Exception as e:
                last_exception = e
            time.sleep(0.5)
            
        self.error_msg = f"Luồng {part_num} chết sau 3 lần thử. Lỗi cuối: {last_exception}"
        return False

    def print_progress(self):
        if self.total_size > 0:
            percent = int((self.downloaded / self.total_size) * 100)
            if percent > 100: percent = 100
            sys.stdout.write(f"\rĐang tiến trình cài đặt... {percent}% / 100%   ")
            sys.stdout.flush()

    def merge_parts(self, num_chunks):
        with open(self.dest, 'wb') as outfile:
            for i in range(num_chunks):
                part_file = f"{self.dest}.part{i}"
                if os.path.exists(part_file):
                    with open(part_file, 'rb') as infile:
                        shutil.copyfileobj(infile, outfile) 
                    os.remove(part_file)

    def download_single(self):
        req = urllib.request.Request(self.url, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=60, context=self.ctx) as response:
                with open(self.dest, 'wb') as f:
                    last_print = 0
                    while True:
                        chunk = response.read(1024 * 256)
                        if not chunk:
                            break
                        f.write(chunk)
                        with self.lock:
                            self.downloaded += len(chunk)
                        now = time.time()
                        if now - last_print > 0.1:
                            self.print_progress()
                            last_print = now
            self.print_progress()
            return True
        except Exception as e:
            self.error_msg = f"Lỗi download đơn luồng: {e}"
            return False

    def start(self):
        supports_range = self.get_file_info()
        
        if supports_range and self.total_size > 0:
            num_chunks = (self.total_size + self.chunk_size - 1) // self.chunk_size
            futures = []
            
            with concurrent.futures.ThreadPoolExecutor(max_workers=self.num_threads) as executor:
                for i in range(num_chunks):
                    start = i * self.chunk_size
                    end = start + self.chunk_size - 1 if i < num_chunks - 1 else self.total_size - 1
                    futures.append(executor.submit(self.download_chunk, start, end, i))
                
                while True:
                    done, not_done = concurrent.futures.wait(futures, timeout=0.1)
                    self.print_progress()
                    if not not_done:
                        break
            
            self.print_progress()
            
            success = True
            for future in futures:
                if not future.result():
                    success = False
            
            if success:
                try:
                    self.merge_parts(num_chunks)
                except Exception as e:
                    raise Exception(f"Lỗi hệ thống khi chắp vá các mảnh file tải về: {e}")
            else:
                raise Exception(f"Quá trình tải đa luồng thất bại. Chi tiết: {self.error_msg}")
        else:
            if not self.download_single():
                raise Exception(f"Quá trình tải đơn luồng thất bại. Chi tiết: {self.error_msg}")
                
        if not (os.path.exists(self.dest) and os.path.getsize(self.dest) > 0):
            raise Exception("File tải về bị rỗng hoặc không được lưu thành công trên ổ đĩa cứng.")
            
        return True

def download_file_with_progress(url, dest):
    downloader = FastDownloader(url, dest, num_threads=16)
    return downloader.start()

def merge_and_replace(src_dir, dst_dir, progress_callback=None):
    total_files = sum([len(files) for r, d, files in os.walk(src_dir)])
    processed = 0
    for root, dirs, files in os.walk(src_dir):
        rel_path = os.path.relpath(root, src_dir)
        if rel_path == '.':
            target_path = dst_dir
        else:
            target_path = os.path.join(dst_dir, rel_path)
        
        if not os.path.exists(target_path):
            try:
                os.makedirs(target_path)
            except Exception as e:
                raise Exception(f"Lỗi quyền truy cập: Không thể tạo thư mục con '{target_path}'. Hệ thống từ chối (Access Denied): {e}")
            
        for file in files:
            src_file = os.path.join(root, file)
            dst_file = os.path.join(target_path, file)
            
            if os.path.exists(dst_file):
                try:
                    os.remove(dst_file)
                except Exception as e:
                    raise Exception(f"Lỗi ghi đè: Không thể thay thế file cũ tại '{dst_file}'. File có thể đang được mở bởi ứng dụng Steam hoặc bị khóa bởi hệ điều hành: {e}")
            try:
                shutil.move(src_file, dst_file)
            except Exception as e:
                raise Exception(f"Lỗi di chuyển: Không thể dời file từ '{src_file}' sang '{dst_file}'. Không đủ dung lượng ổ cứng hoặc quyền truy cập bị chặn: {e}")
            processed += 1
            if progress_callback and total_files > 0:
                percent = 80 + (processed / total_files) * 15
                progress_callback(percent)

def main():
    os.system("cls" if os.name == "nt" else "clear")
    print("Đang Kiểm Tra Thư Mục Của Steam")
    
    target_dir = get_steam_install_path()
    if not target_dir:
        print("\n[LỖI NGHIÊM TRỌNG] Không tìm thấy thư mục cài đặt Steam. Registry: HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam bị thiếu hoặc sai lệch.")
        os.system("pause >nul")
        return
        
    if is_steam_running():
        sys.stdout.write("Steam đang đang chạy, nhấn enter để tắt...")
        sys.stdout.flush()
        while True:
            if msvcrt.kbhit():
                key = msvcrt.getch()
                if key == b'\r':
                    break
            time.sleep(0.01)
            
        print("")
        while is_steam_running():
            kill_steam()
            time.sleep(1)
            
    file_id = "1VuPuM_XUWD1Jeiuyw0UaNdNaH2zTreEL"
    zip_filename = "Nexus.zip"
    
    appdata = os.getenv('APPDATA')
    if not appdata:
        appdata = os.path.expanduser("~")
        
    hidden_dir = os.path.join(appdata, "NexusHideout")
    
    try:
        if not os.path.exists(hidden_dir):
            os.makedirs(hidden_dir)
            try:
                FILE_ATTRIBUTE_HIDDEN = 0x02
                ctypes.windll.kernel32.SetFileAttributesW(hidden_dir, FILE_ATTRIBUTE_HIDDEN)
            except Exception:
                pass
    except Exception as e:
        print(f"\n[LỖI HỆ THỐNG] Không thể tạo phân vùng giấu kín NexusHideout.")
        print(f"Nguyên nhân: {type(e).__name__}: {str(e)}")
        traceback.print_exc()
        os.system("pause >nul")
        return
    
    zip_path = os.path.join(hidden_dir, zip_filename)
    extract_dir = os.path.join(hidden_dir, "extracted_files")
    
    try:
        if os.path.exists(extract_dir):
            shutil.rmtree(extract_dir)
        os.makedirs(extract_dir, exist_ok=True)
    except Exception as e:
        print(f"\n[LỖI XUNG ĐỘT] Không thể dọn sạch thư mục giải nén từ lần chạy trước.")
        print(f"Nguyên nhân: {type(e).__name__}: {str(e)}")
        traceback.print_exc()
        os.system("pause >nul")
        return
    
    try:
        import gdown
        def my_progress(downloaded, total_size):
            if total_size and total_size > 0:
                percent = (downloaded / total_size) * 50
                print_overall_progress(percent)
        gdown.download(id=file_id, output=zip_path, quiet=True, progress=my_progress)
    except Exception as e:
        print(f"\n\n[LỖI MẠNG] Giai đoạn Tải dữ liệu từ máy chủ thất bại.")
        print(f"Chi tiết mã lỗi: {type(e).__name__}: {str(e)}")
        traceback.print_exc()
        os.system("pause >nul")
        return
        
    try:
        import pyzipper
        with pyzipper.AESZipFile(zip_path, 'r') as zip_ref:
            file_list = zip_ref.namelist()
            total_files = len(file_list)
            for i, file in enumerate(file_list, 1):
                zip_ref.extract(file, path=extract_dir, pwd=b'r09903uLBu89VQEQ8z')
                percent = 50 + (i / total_files) * 30
                print_overall_progress(percent)
    except zipfile.BadZipFile as e:
        print(f"\n[LỖI DỮ LIỆU] Giai đoạn Giải nén thất bại. File ZIP tải về bị hỏng, sai định dạng hoặc bị ngắt quãng giữa chừng.")
        print(f"Mã lỗi kỹ thuật: BadZipFile: {str(e)}")
        traceback.print_exc()
        os.system("pause >nul")
        return
    except Exception as e:
        print(f"\n[LỖI HỆ THỐNG] Giai đoạn Giải nén tập tin vào phân vùng kín thất bại.")
        print(f"Nguyên nhân: {type(e).__name__}: {str(e)}")
        traceback.print_exc()
        os.system("pause >nul")
        return
        
    try:
        os.remove(zip_path)
    except Exception:
        pass
        
    if not os.path.exists(target_dir):
        try:
            os.makedirs(target_dir)
        except Exception as e:
            print(f"\n[LỖI HỆ THỐNG] Không thể tự tạo lại thư mục Steam gốc đã mất.")
            print(f"Nguyên nhân: {type(e).__name__}: {str(e)}")
            traceback.print_exc()
            os.system("pause >nul")
            return
            
    try:
        merge_and_replace(extract_dir, target_dir, progress_callback=print_overall_progress)
        try:
            shutil.rmtree(extract_dir)
        except Exception:
            pass
    except Exception as e:
        print(f"\n[LỖI GHI ĐÈ FILE] Quá trình Cắt và Dán đè (Replace) vào thư mục Steam gặp sự cố nghiêm trọng.")
        print(f"Mã lỗi và lý do cụ thể:\n{str(e)}")
        print("\nTraceback mã nguồn để fix lỗi:")
        traceback.print_exc()
        os.system("pause >nul")
        return
        
    try:
        if os.path.exists(hidden_dir):
            try:
                FILE_ATTRIBUTE_NORMAL = 0x80
                ctypes.windll.kernel32.SetFileAttributesW(hidden_dir, FILE_ATTRIBUTE_NORMAL)
            except Exception:
                pass
            shutil.rmtree(hidden_dir)
    except Exception:
        pass
        
    print_overall_progress(100)
    print("\n\nThành công")
    
    start_steam(target_dir)
    
    while True:
        choice = input("Nếu game chưa hiện ở thư viện, ghi \"b\" để khởi động lại steam, nếu game đã hiện thị ở thư viện rồi hãy ghi \"c\" để exit: ").strip().lower()
        if choice == 'b':
            while is_steam_running():
                kill_steam()
                time.sleep(1)
            start_steam(target_dir)
        elif choice == 'c':
            break

if __name__ == "__main__":
    main()
