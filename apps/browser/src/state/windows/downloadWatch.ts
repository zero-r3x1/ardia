import { openDownload } from "../downloads/openDownload";
import { useBrowser, type BrowserState } from "../browser/store";
import { downloadVisibleIn } from "../downloads/downloadsSlice";
import { awaitsKeep } from "../downloads/status";
import { focusedWindowOf } from "./ui";

const openWhenDone = new Set<string>();

let openingWhenDone = false;

export function startOpenWhenDone() {
  if (openingWhenDone) return;
  openingWhenDone = true;
  useBrowser.subscribe((s, prev) => {
    if (s.downloads === prev.downloads || !openWhenDone.size) return;
    for (const d of s.downloads) {
      if (d.state !== "downloading" && openWhenDone.delete(d.id) && d.state === "finished") void openDownload(d.path);
    }
  });
}

export const opensWhenDone = (id: string) => openWhenDone.has(id);

export function toggleOpenWhenDone(id: string) {
  if (openWhenDone.has(id)) openWhenDone.delete(id);
  else openWhenDone.add(id);
}

export const onDownloadsChanged = (listener: () => void) =>
  useBrowser.subscribe((s, prev) => {
    if (s.downloads !== prev.downloads) listener();
  });

export function watchNewDownloads(windowId: string, onFresh: (download: BrowserState["downloads"][number]) => void) {
  const seen = new Set(useBrowser.getState().downloads.map((d) => d.id));
  return useBrowser.subscribe((s, prev) => {
    if (s.downloads === prev.downloads) return;
    const fresh = s.downloads.find((d) => !seen.has(d.id));
    s.downloads.forEach((d) => seen.add(d.id));
    if (!fresh || focusedWindowOf(s) !== windowId || !downloadVisibleIn(s, fresh, s.windows[windowId])) return;
    onFresh(fresh);
  });
}

export function watchDownloadActivity(windowId: string, announce: (id: string) => void) {
  const pending = new Map<string, "downloading" | "failed">();
  const stopNew = watchNewDownloads(windowId, (download) => {
    if (download.state === "downloading" || download.state === "failed") pending.set(download.id, download.state);
    if (!awaitsKeep(download)) announce(download.id);
  });
  const stopUpdates = useBrowser.subscribe((s, prev) => {
    if (s.downloads === prev.downloads || !pending.size) return;
    for (const [id, previous] of pending) {
      const download = s.downloads.find((row) => row.id === id);
      if (download?.state === previous) continue;
      if (download?.state === "downloading" || download?.state === "failed") pending.set(id, download.state);
      else pending.delete(id);
      if (download && !awaitsKeep(download) && downloadVisibleIn(s, download, s.windows[windowId])) announce(id);
    }
  });
  return () => {
    stopNew();
    stopUpdates();
  };
}
