"""Inspect Windows monitor/window DPI; optionally move only the specified test process."""
import argparse,ctypes,json,time
from ctypes import wintypes as w
u=ctypes.WinDLL('user32',use_last_error=True);sh=ctypes.WinDLL('shcore')
u.SetThreadDpiAwarenessContext.argtypes=[w.HANDLE];u.SetThreadDpiAwarenessContext.restype=w.HANDLE
u.SetThreadDpiAwarenessContext(w.HANDLE(-4))
class MI(ctypes.Structure):
    _fields_=[('size',w.DWORD),('monitor',w.RECT),('work',w.RECT),('flags',w.DWORD),('device',w.WCHAR*32)]
monitors=[]
CALLBACK=ctypes.WINFUNCTYPE(w.BOOL,w.HMONITOR,w.HDC,ctypes.POINTER(w.RECT),w.LPARAM)
u.GetMonitorInfoW.argtypes=[w.HMONITOR,ctypes.POINTER(MI)]
sh.GetScaleFactorForMonitor.argtypes=[w.HMONITOR,ctypes.POINTER(ctypes.c_int)]
@CALLBACK
def monitor(handle,dc,rect,data):
    info=MI();info.size=ctypes.sizeof(info);u.GetMonitorInfoW(handle,ctypes.byref(info));scale=ctypes.c_int()
    sh.GetScaleFactorForMonitor(handle,ctypes.byref(scale))
    monitors.append({'device':info.device,'primary':bool(info.flags&1),'scale':scale.value,'bounds':[info.monitor.left,info.monitor.top,info.monitor.right,info.monitor.bottom],'work':[info.work.left,info.work.top,info.work.right,info.work.bottom]});return True
u.EnumDisplayMonitors(None,None,monitor,0)
parser=argparse.ArgumentParser();parser.add_argument('--pid',type=int);parser.add_argument('--move-monitor',type=int);parser.add_argument('--title',default='Schedule');args=parser.parse_args()
result={'monitors':monitors}
if args.pid:
    handles=[]
    ENUM=ctypes.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
    u.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)]
    u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,ctypes.c_int]
    @ENUM
    def find(handle,data):
        pid=w.DWORD();u.GetWindowThreadProcessId(handle,ctypes.byref(pid));title=ctypes.create_unicode_buffer(200);u.GetWindowTextW(handle,title,200)
        if pid.value==args.pid and title.value==args.title:handles.append(handle)
        return True
    u.EnumWindows(find,0)
    if not handles:raise RuntimeError('Schedule window not found')
    handle=handles[0]
    if args.move_monitor is not None:
        # The caller supplies an isolated fixture PID; never selects a process by name for movement.
        target=monitors[args.move_monitor];box=target['work'];width=min(round(1100*target['scale']/100),box[2]-box[0]-40);height=min(round(760*target['scale']/100),box[3]-box[1]-40)
        u.SetWindowPos.argtypes=[w.HWND,w.HWND,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,w.UINT]
        u.SetWindowPos(handle,None,box[0]+20,box[1]+20,0,0,0x0015);time.sleep(.3)
        u.SetWindowPos(handle,None,0,0,width,height,0x0016);time.sleep(.3)
    u.GetWindowDpiAwarenessContext.argtypes=[w.HWND];u.GetWindowDpiAwarenessContext.restype=w.HANDLE
    u.AreDpiAwarenessContextsEqual.argtypes=[w.HANDLE,w.HANDLE]
    u.GetAwarenessFromDpiAwarenessContext.argtypes=[w.HANDLE];u.GetDpiForWindow.argtypes=[w.HWND]
    context=u.GetWindowDpiAwarenessContext(handle)
    rect=w.RECT();u.GetWindowRect.argtypes=[w.HWND,ctypes.POINTER(w.RECT)];u.GetWindowRect(handle,ctypes.byref(rect))
    result['window']={'pid':args.pid,'dpi':u.GetDpiForWindow(handle),'perMonitorV2':bool(u.AreDpiAwarenessContextsEqual(context,w.HANDLE(-4))),'awareness':u.GetAwarenessFromDpiAwarenessContext(context),'width':rect.right-rect.left,'height':rect.bottom-rect.top}
print(json.dumps(result))
