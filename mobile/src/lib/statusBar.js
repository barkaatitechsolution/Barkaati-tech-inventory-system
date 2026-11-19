import { Capacitor } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";

export async function configureStatusBar() {
  if (!Capacitor.isNativePlatform()) return;

  let inset = 0;
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    const info = await StatusBar.getInfo();
    if (info?.overlays) inset = Number(info.height) || 0;
  } catch {
    try {
      const info = await StatusBar.getInfo();
      inset = Number(info?.height) || 0;
    } catch {
      inset = 0;
    }
  }
  document.documentElement.style.setProperty("--status-bar-inset", `${inset}px`);
}

export function configureViewport() {
  const root = document.documentElement;
  const update = () => {
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    root.style.setProperty("--app-height", `${Math.round(height)}px`);
    root.style.setProperty("--bottom-nav-height", "57px");
  };
  update();
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  window.visualViewport?.addEventListener("resize", update);
  window.visualViewport?.addEventListener("scroll", update);
}
