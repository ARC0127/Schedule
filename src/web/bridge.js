(() => {
  const pending = new Map();
  let serial = 0;
  const call = (method, payload = null, files = null) =>
    new Promise((resolve, reject) => {
      const id = String(++serial);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Windows 未及时响应，请检查路径或稍后重试。"));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      try {
        if (files)
          window.chrome.webview.postMessageWithAdditionalObjects(
            { id, method, payload },
            files,
          );
        else window.chrome.webview.postMessage({ id, method, payload });
      } catch (e) {
        pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  window.chrome.webview.addEventListener("message", ({ data }) => {
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    clearTimeout(item.timer);
    if (data.error) item.reject(Error(data.error));
    else item.resolve(data.result);
  });
  window.journalNative = { call, schedules: {} };
  window.openai = {
    setWidgetState: (state) => call("saveState", state),
  };
})();
