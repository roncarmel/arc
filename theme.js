// theme.js: the page's colors, made from two colors.
//
//   accent   the color of actions and highlights: buttons, the title, links, the tint on rows, the bar.
//   neutral  the color of everything else: backgrounds, borders, text, covers.
//
// Everything else is worked out from those two, for both light and dark mode, and handed to the page as CSS
// variables (--bg, --fg, --button, and so on). The styles in index.html only ever use those variables, so
// giving this file two different colors changes the whole look.
//
// To add a theme, add a line to THEMES. To try two colors without changing any file, open the page with
// ?accent=0a84ff&neutral=8a8a92 on the end of the address (hex colors; ?theme=reset goes back).
// This file runs first, in the <head>, so the colors are in place before anything is drawn.

const THEMES = [
  { id: "pinks-and-grays", name: "Pinks and grays", accent: "#ff38b8", neutral: "#8a8a92" },
];

// ---------------------------------------------------------------- color math
function normalizeHex(text) {
  const t = String(text || "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) return "#" + t.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(t) ? "#" + t : null;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function luminance(hex) {
  const lin = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// the accent, nudged lighter or darker until text in it is easy to read on the background
function readableAccent(accent, background, dark) {
  const [h, s, l0] = rgbToHsl(hexToRgb(accent));
  let l = l0;
  let color = accent;
  for (let i = 0; i < 40 && contrastRatio(color, background) < 4.5; i += 1) {
    l = dark ? Math.min(0.95, l + 0.02) : Math.max(0.05, l - 0.02);
    color = rgbToHex(hslToRgb([h, s, l]));
  }
  return color;
}

// ---------------------------------------------------------------- the variables
function themeVariables(accent, neutral, dark) {
  const [hue, sat] = rgbToHsl(hexToRgb(neutral));
  const tone = (lightness) => rgbToHex(hslToRgb([hue, Math.min(sat, 0.3), lightness]));
  const ramp = dark
    ? { bg: tone(0.087), card: tone(0.127), line: tone(0.205), fg: tone(0.955), muted: tone(0.62), cover: tone(0.24) }
    : { bg: tone(1), card: tone(0.965), line: tone(0.86), fg: tone(0.12), muted: tone(0.43), cover: tone(0.82) };
  const whiteText = contrastRatio(accent, "#ffffff") >= 3;
  const deep = rgbToHex(hexToRgb(accent).map((v) => v * 0.66));
  return {
    "--bg": ramp.bg,
    "--card": ramp.card,
    "--line": ramp.line,
    "--fg": ramp.fg,
    "--muted": ramp.muted,
    "--cover": ramp.cover,
    "--silence-line": neutral,
    "--button": accent,
    "--on-button": whiteText ? "#ffffff" : "#111111",
    "--icon-filter": whiteText ? "none" : "invert(1)",   // the button icons are white drawings
    "--accent": readableAccent(accent, ramp.bg, dark),
    "--accent-deep": deep,
    "--accent-tint": withAlpha(accent, 0.15),
    "--accent-tint-border": withAlpha(accent, 0.5),
    "--accent-wash": withAlpha(accent, 0.22),
  };
}

function applyColors(accent, neutral) {
  const dark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const vars = themeVariables(accent, neutral, dark);
  for (const [name, value] of Object.entries(vars)) document.documentElement.style.setProperty(name, value);
}

// ---------------------------------------------------------------- which colors are in use
function chosenColors() {
  // 1. colors typed into the address (kept for this tab, so they survive the trip to Spotify and back)
  try {
    const params = new URLSearchParams(location.search);
    if (params.get("theme") === "reset") sessionStorage.removeItem("themeColors");
    const accent = normalizeHex(params.get("accent"));
    const neutral = normalizeHex(params.get("neutral"));
    if (accent && neutral) sessionStorage.setItem("themeColors", JSON.stringify({ accent, neutral }));
    const typed = JSON.parse(sessionStorage.getItem("themeColors") || "null");
    if (typed && normalizeHex(typed.accent) && normalizeHex(typed.neutral)) return { custom: true, accent: typed.accent, neutral: typed.neutral };
  } catch (err) { /* storage can be unavailable; fall through to the saved theme */ }
  // 2. the theme chosen in More options
  let id = "";
  try { id = localStorage.getItem("theme") || ""; } catch (err) { id = ""; }
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  return { custom: false, id: theme.id, accent: theme.accent, neutral: theme.neutral };
}

function applyStoredTheme() {
  const colors = chosenColors();
  applyColors(colors.accent, colors.neutral);
  return colors;
}

function setTheme(id) {
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  try { localStorage.setItem("theme", theme.id); sessionStorage.removeItem("themeColors"); } catch (err) { /* the theme still applies for now */ }
  applyColors(theme.accent, theme.neutral);
}

// The page's own colors follow the system's light or dark setting, so the variables are worked out again when it changes.
if (window.matchMedia) {
  const watcher = window.matchMedia("(prefers-color-scheme: dark)");
  const again = () => applyStoredTheme();
  if (watcher.addEventListener) watcher.addEventListener("change", again);
  else if (watcher.addListener) watcher.addListener(again);
}

applyStoredTheme();
