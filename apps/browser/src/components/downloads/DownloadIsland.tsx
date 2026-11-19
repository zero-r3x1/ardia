import { useEffect, useMemo, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { useDownloads, useWindowId, useWindowProfileId } from "../../state/browser/hooks";
import { useDownloadProgress, withProgress } from "../../state/downloads/progress";
import { cancelDownload } from "../../state/downloads/actions";
import { awaitsKeep } from "../../state/downloads/status";
import { watchDownloadActivity } from "../../state/windows/downloadWatch";
import { capsule, reduceMotion, Surface, Symbol, tabularNums, Text, useHover, usePresence, useTheme } from "../ui";

const WIDTH = 290;
const HEIGHT = 56;
const HOLD_MS = 3000;
const RING_SIZE = 30;
const RING_STROKE = 2;
const MOTION = {
  show: { duration: 510, easing: Easing.bezier(0.22, 0.65, 0.26, 1) },
  hide: { duration: 380, easing: Easing.bezier(0.4, 0, 0.46, 1) },
};

export function DownloadIsland({ top }: { top: number }) {
  const windowId = useWindowId();
  const profile = useWindowProfileId();
  return <WindowDownloadIsland key={JSON.stringify([windowId, profile])} windowId={windowId} top={top} />;
}

function WindowDownloadIsland({ windowId, top }: { windowId: string; top: number }) {
  const [notice, setNotice] = useState<{ id: string } | null>(null);
  const record = useDownloads(windowId, (downloads) => {
    const row = downloads.find((d) => d.id === notice?.id);
    return row && !awaitsKeep(row) ? row : undefined;
  });
  const id = record?.id;
  const progress = useDownloadProgress((s) => id === undefined ? undefined : s[id]);
  const download = withProgress(record, progress);

  useEffect(() => watchDownloadActivity(windowId, (id) => setNotice({ id })), [windowId]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice((current) => current === notice ? null : current), HOLD_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const { shown, appear } = usePresence(download ?? null, MOTION);
  const theme = useTheme();
  const moving = reduceMotion() === false;
  const motion = useMemo(() => ({
    shell: [
      { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
      { scaleX: appear.interpolate({ inputRange: [0, 1], outputRange: [0.42, 1] }) },
      { scaleY: appear.interpolate({ inputRange: [0, 1], outputRange: [0.68, 1] }) },
    ],
    text: appear.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0, 1] }),
    textY: appear.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }),
  }), [appear]);
  if (!shown) return null;

  const finished = shown.state === "finished";
  const downloading = shown.state === "downloading";
  const title = downloading ? (shown.paused ? "Paused" : "Downloading")
    : finished ? "Download complete" : shown.state === "cancelled" ? "Download cancelled" : "Download failed";
  const filename = shown.filename || "File";
  const fraction = finished ? 1 : downloading && shown.total > 0 ? Math.max(0, Math.min(1, shown.received / shown.total)) : undefined;
  const percent = fraction === undefined ? undefined : Math.round(fraction * 100);
  const colors = theme.dark
    ? { fill: "#292929", rim: "#565656", title: "#ffffff", detail: "#b4b4b4", track: "#494949", progress: "#7bdcab" }
    : { fill: "#eeedeb", rim: "#ccc9c5", title: "#191919", detail: "#575652", track: "#d3d1cd", progress: "#23734a" };
  const accent = !downloading && !finished ? theme.destructive : shown.paused ? colors.detail : colors.progress;

  return (
    <View pointerEvents="box-none" style={[styles.position, { top }]}>
      <View pointerEvents="box-none" style={styles.bounds}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: appear, transform: moving ? motion.shell : undefined }]}>
          <Surface fill={colors.fill} borderColor={colors.rim} borderWidth={StyleSheet.hairlineWidth} cornerRadius={capsule(HEIGHT)} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View
          pointerEvents={download ? "box-none" : "none"}
          style={[styles.content, { opacity: moving ? motion.text : appear, transform: moving ? [{ translateY: motion.textY }] : undefined }]}
        >
          <View
            pointerEvents="none"
            testID="download-island"
            accessible={download !== undefined}
            accessibilityLabel={`${title}, ${filename}`}
            accessibilityRole={downloading ? "progressbar" : undefined}
            accessibilityValue={percent === undefined ? undefined : { min: 0, max: 100, now: percent }}
            style={styles.status}
          >
            <View style={styles.ring}>
              {fraction !== undefined && <ProgressRing fraction={fraction} track={colors.track} color={accent} />}
              <Symbol name={finished ? "checkmark" : downloading ? (shown.paused ? "pause.fill" : "arrow.down") : "xmark"} size={fraction === undefined ? 16 : 12} color={accent} />
            </View>
            <View style={styles.labels}>
              <Text size="caption" weight="semibold" lines={1} color={colors.title}>{title}</Text>
              <Text size="caption" lines={1} color={colors.detail}>{filename}</Text>
            </View>
            {percent !== undefined && <Text size="caption" weight="semibold" color={accent} style={tabularNums}>{percent}%</Text>}
          </View>
          {downloading && <CancelButton id={shown.id} color={colors.detail} fill={colors.track} disabled={!download} />}
        </Animated.View>
      </View>
    </View>
  );
}

function ProgressRing({ fraction, track, color }: { fraction: number; track: string; color: string }) {
  return (
    <>
      <View style={[styles.ringStroke, { borderColor: fraction === 1 ? color : track }]} />
      {fraction > 0 && fraction < 1 && <RingHalf degrees={Math.min(180, fraction * 360)} color={color} />}
      {fraction > 0.5 && fraction < 1 && <RingHalf degrees={fraction * 360 - 180} color={color} opposite />}
    </>
  );
}

function RingHalf({ degrees, color, opposite = false }: { degrees: number; color: string; opposite?: boolean }) {
  return (
    <View style={[StyleSheet.absoluteFill, opposite && styles.opposite]}>
      <View style={styles.ringRight}>
        <View style={[styles.ringRotor, { transform: [{ rotate: `${degrees}deg` }] }]}>
          <View style={styles.ringLeft}>
            <View style={[styles.ringStroke, { borderColor: color }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

function CancelButton({ id, color, fill, disabled }: { id: string; color: string; fill: string; disabled: boolean }) {
  const { hovered, hoverProps } = useHover();
  const cancel = () => {
    if (!disabled) void cancelDownload(id);
  };
  return (
    <Pressable
      {...hoverProps}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Cancel download"
      disabled={disabled}
      onPress={cancel}
      onAccessibilityTap={cancel}
      style={({ pressed }) => [styles.cancel, (hovered || pressed) && { backgroundColor: fill }]}
    >
      <Symbol name="xmark" size={12} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  position: { position: "absolute", left: 12, right: 12, alignItems: "center" },
  bounds: { height: HEIGHT, width: WIDTH, maxWidth: "100%" },
  content: { flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10 },
  status: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  labels: { flex: 1, minWidth: 0, gap: 2 },
  ring: { width: RING_SIZE, height: RING_SIZE, alignItems: "center", justifyContent: "center" },
  ringStroke: { position: "absolute", left: 0, top: 0, width: RING_SIZE, height: RING_SIZE, borderWidth: RING_STROKE, borderRadius: RING_SIZE / 2 },
  ringRight: { position: "absolute", right: 0, top: 0, bottom: 0, width: RING_SIZE / 2, overflow: "hidden" },
  ringRotor: { position: "absolute", left: -RING_SIZE / 2, top: 0, width: RING_SIZE, height: RING_SIZE },
  ringLeft: { position: "absolute", left: 0, top: 0, bottom: 0, width: RING_SIZE / 2, overflow: "hidden" },
  opposite: { transform: [{ rotate: "180deg" }] },
  cancel: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});
