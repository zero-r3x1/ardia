import assert from "node:assert/strict";
import { test } from "node:test";
import { PLATFORM_FEATURES } from "../../lib/platformFeatures.ts";
const { useBrowser } = await import("../browser/store.ts");
const { dismissDownloadsByPress, setDownloadsOpen, toggleDownloadsOpen } = await import("../windows/actions.ts");
const { takeDownloadsPanelCounts } = await import("../telemetry/downloadsPanelCounts.ts");
const { watchDownloadActivity } = await import("../windows/downloadWatch.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const download = (id, extra = {}) => ({
  id, url: `https://dl.example/${id}`, filename: id, path: `/tmp/${id}`, state: "downloading", paused: false, received: 0, total: 1, speed: 0, mimeType: "", profile: "", ...extra,
});

function oneWindow() {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const w = S().createWindow({ url: "https://a.example/" });
  S().setFocusedWindow(w);
  setDownloadsOpen(w, false);
  takeDownloadsPanelCounts();
  return w;
}
const isOpen = (w) => !!S().windowUi[w]?.downloadsOpen;

test("a new download opens the Downloads panel, and a click on the page still goes through", () => {
  const w = oneWindow();
  S().upsertDownload(download("one"));
  assert.equal(isOpen(w), true);
  dismissDownloadsByPress(w, { nativeEvent: { timestamp: 1000 } });
  assert.equal(isOpen(w), false, "the press on the next link closes the panel and reaches the page");
  S().upsertDownload(download("two"));
  assert.equal(isOpen(w), true, "the second download opens it again");
  setDownloadsOpen(w, false);
  S().upsertDownload({ ...download("one"), state: "finished" });
  assert.equal(S().downloads.length, 2);
  assert.equal(isOpen(w), false, "an update to a listed download doesn't reopen it");
});

test("a download held for Keep or Discard opens the panel once", () => {
  const w = oneWindow();
  S().upsertDownload(download("insecure", { url: "http://dl.example/x", dangerous: true }));
  assert.equal(isOpen(w), true);
  setDownloadsOpen(w, false);
  S().upsertDownload(download("insecure", { url: "http://dl.example/x", dangerous: true, received: 1 }));
  assert.equal(isOpen(w), false, "an update to the same held download doesn't reopen it");
  assert.equal(takeDownloadsPanelCounts().downloads_panel_held_opens, 1);
});

test("the download island replaces the automatic panel, except for a download held for Keep or Discard", (t) => {
  const previous = PLATFORM_FEATURES.downloadIsland;
  PLATFORM_FEATURES.downloadIsland = true;
  t.after(() => { PLATFORM_FEATURES.downloadIsland = previous; });
  const w = oneWindow();
  S().upsertDownload(download("island"));
  assert.equal(isOpen(w), false);
  toggleDownloadsOpen(w);
  assert.equal(isOpen(w), true);
  setDownloadsOpen(w, false);
  S().upsertDownload(download("island", { dangerous: true }));
  assert.equal(isOpen(w), true);
});

const pressAt = (timestamp) => ({ nativeEvent: { timestamp } });

test("download notices announce starts and terminal states once, even when another download starts in between", (t) => {
  const w = oneWindow();
  S().upsertDownload(download("existing"));
  const announced = [];
  t.after(watchDownloadActivity(w, (id) => announced.push(id)));
  S().upsertDownload(download("slow"));
  S().upsertDownload(download("slow", { received: 1 }));
  S().upsertDownload(download("fast"));
  S().upsertDownload(download("slow", { state: "finished" }));
  S().upsertDownload(download("fast", { state: "cancelled" }));
  S().upsertDownload(download("existing", { state: "finished" }));
  assert.deepEqual(announced, ["slow", "fast", "slow", "fast"]);
});

test("an interrupted download announces resumed progress and completion under the same ID", (t) => {
  const w = oneWindow();
  const announced = [];
  t.after(watchDownloadActivity(w, (id) => {
    announced.push([id, S().downloads.find((entry) => entry.id === id)?.state]);
  }));
  const file = download("resumed", { total: 100 });
  S().upsertDownload(file);
  S().upsertDownload({ ...file, state: "failed", received: 30 });
  S().upsertDownload({ ...file, state: "failed", received: 30, speed: 1 });
  S().upsertDownload({ ...file, received: 30 });
  S().upsertDownload({ ...file, received: 75 });
  S().upsertDownload({ ...file, state: "finished", received: 100 });
  S().upsertDownload({ ...file, state: "finished", received: 100, speed: 1 });
  const coalesced = download("resumed-completed", { total: 100 });
  S().upsertDownload(coalesced);
  S().upsertDownload({ ...coalesced, state: "failed", received: 30 });
  S().upsertDownload({ ...coalesced, state: "finished", received: 100 });
  assert.deepEqual(announced, [
    [file.id, "downloading"],
    [file.id, "failed"],
    [file.id, "downloading"],
    [file.id, "finished"],
    [coalesced.id, "downloading"],
    [coalesced.id, "failed"],
    [coalesced.id, "finished"],
  ]);
});

test("a press outside closes the panel, and the press that lands on the Downloads button doesn't reopen it", () => {
  const w = oneWindow();
  toggleDownloadsOpen(w);
  assert.equal(isOpen(w), true);
  dismissDownloadsByPress(w, pressAt(1000));
  assert.equal(isOpen(w), false);
  toggleDownloadsOpen(w, 1000);
  assert.equal(isOpen(w), false, "the press that closed it from outside lands on the button");
  toggleDownloadsOpen(w, 1450);
  assert.equal(isOpen(w), true, "the next press opens it");
  dismissDownloadsByPress(w, pressAt(1900));
  dismissDownloadsByPress(w, pressAt(1950));
  assert.equal(takeDownloadsPanelCounts().downloads_panel_press_closes, 2, "only a press that closed it counts");
});

test("a quick click on the Downloads button after a click elsewhere closed the panel opens it", () => {
  const w = oneWindow();
  toggleDownloadsOpen(w);
  dismissDownloadsByPress(w, pressAt(5000));
  assert.equal(isOpen(w), false);
  toggleDownloadsOpen(w, 5120);
  assert.equal(isOpen(w), true, "a separate press 120 ms later is not the press that closed it");
});

test("the press that closed the panel stays ignored however long it is held", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const w = oneWindow();
  toggleDownloadsOpen(w);
  dismissDownloadsByPress(w, pressAt(8000));
  t.mock.timers.tick(2500);
  toggleDownloadsOpen(w, 8000);
  assert.equal(isOpen(w), false, "a release 2.5 s after the press is still that press");
});

test("a toggle with no press, or from another window's press, isn't taken for the press that closed the panel", () => {
  const w = oneWindow();
  const other = S().createWindow({ url: "https://b.example/" });
  toggleDownloadsOpen(w);
  dismissDownloadsByPress(w, pressAt(3000));
  toggleDownloadsOpen(w);
  assert.equal(isOpen(w), true, "a toggle without a press opens it");
  setDownloadsOpen(w, false);
  toggleDownloadsOpen(other);
  dismissDownloadsByPress(other, pressAt(4000));
  toggleDownloadsOpen(w, 4000);
  assert.equal(isOpen(w), true, "a press that closed another window's panel doesn't hold this one");
  assert.equal(isOpen(other), false);
});

test("an outside press without a timestamp never swallows a later press", () => {
  const w = oneWindow();
  toggleDownloadsOpen(w);
  dismissDownloadsByPress(w, { nativeEvent: {} });
  toggleDownloadsOpen(w, undefined);
  assert.equal(isOpen(w), true);
});
