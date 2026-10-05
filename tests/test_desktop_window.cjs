const test = require('node:test');
const assert = require('node:assert/strict');
const { MAIN_WINDOW_SIZE, resizeMainWindow } = require('../electron-shell/window-layout');

function nativeWindow(rounding = 0) {
  let content = [900, 460];
  const requests = [];
  return {
    requests,
    isDestroyed: () => false,
    getContentSize: () => [...content],
    getBounds: () => { throw new Error('Outer bounds must not determine content size'); },
    setSize: () => { throw new Error('Do not alternate outer and content resize APIs'); },
    setContentSize: (width, height) => { requests.push([width, height]); content = [width + rounding, height + rounding]; }
  };
}

test('Repeated resize notifications never grow the window at fractional DPI', () => {
  for (const rounding of [-1, 0, 1]) {
    const window = nativeWindow(rounding);
    for (let i = 0; i < 100; i++) resizeMainWindow(window, false);
    assert.deepEqual(window.requests, [[MAIN_WINDOW_SIZE.width, MAIN_WINDOW_SIZE.height]]);
  }
});

test('Expanding and collapsing panels changes height once and preserves room width', () => {
  const window = nativeWindow(1);
  resizeMainWindow(window, false);
  for (let i = 0; i < 100; i++) resizeMainWindow(window, true);
  for (let i = 0; i < 100; i++) resizeMainWindow(window, false);
  assert.equal(window.requests.length, 3);
  assert.ok(window.requests[1][1] >= 643, 'Expanded notes must fit below the room');
  assert.ok(window.requests.every(([width]) => width === MAIN_WINDOW_SIZE.width));
  assert.deepEqual(window.requests[2], window.requests[0]);
});

test('Late resize requests ignore closed or missing windows', () => {
  resizeMainWindow(null, true);
  resizeMainWindow({isDestroyed: () => true}, false);
});
