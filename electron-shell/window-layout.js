// Electron sizes are device-independent content pixels, including on mixed-DPI displays.
const MAIN_WINDOW_SIZE = Object.freeze({ width: 700, height: 470 });
const EXPANDED_HEIGHT = 650;

function resizeMainWindow(window, expanded) {
  if (!window || window.isDestroyed()) return;
  const { width } = MAIN_WINDOW_SIZE;
  const height = expanded ? EXPANDED_HEIGHT : MAIN_WINDOW_SIZE.height;
  const [currentWidth, currentHeight] = window.getContentSize();
  // Fractional Windows scaling can round by one DIP. Do not feed that back into resizing.
  if (Math.abs(currentWidth - width) <= 1 && Math.abs(currentHeight - height) <= 1) return;
  window.setContentSize(width, height);
}

module.exports = { MAIN_WINDOW_SIZE, resizeMainWindow };
