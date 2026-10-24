// Approximation sampled from the user's original Falling Ballz screenshot.
// These are visual reference samples, not an official published numeric palette.
(() => {
  const anchors = [
    [2, [248, 211, 71]],
    [5, [254, 247, 81]],
    [32, [118, 251, 108]],
    [37, [119, 250, 156]],
    [38, [117, 251, 166]],
    [72, [75, 8, 245]],
  ];
  function hsv(rgb) {
    const [r, g, b] = rgb.map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, max ? d / max : 0, max];
  }
  function color(hp, brightness = 1) {
    const rgbColor = rgb => `rgb(${rgb.map(v => Math.round(v * brightness)).join(', ')})`;
    if (hp <= anchors[0][0]) return rgbColor(anchors[0][1]);
    for (let i = 1; i < anchors.length; i++) {
      const [n, rgb] = anchors[i], [previous, oldRgb] = anchors[i - 1];
      if (hp > n) continue;
      const t = (hp - previous) / (n - previous);
      const a = hsv(oldRgb), b = hsv(rgb);
      const h = a[0] + (b[0] - a[0]) * t;
      const s = a[1] + (b[1] - a[1]) * t;
      const v = (a[2] + (b[2] - a[2]) * t) * brightness;
      const l = v * (1 - s / 2);
      const saturation = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
      return `hsl(${h} ${saturation * 100}% ${l * 100}%)`;
    }
    return rgbColor(anchors.at(-1)[1]);
  }
  window.BallzPalette = { color, anchors };
})();
