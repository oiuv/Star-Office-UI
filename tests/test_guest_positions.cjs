const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const layouts = ['index.html', 'electron-standalone.html'].map(file => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend', file), 'utf8');
  const start = source.indexOf('function getAreaPoint(area, idx) {');
  const end = source.indexOf('function renderGuestAgentsInScene()', start);
  return vm.runInNewContext(source.slice(start, end) + '; getAreaPoint;');
});
for (const area of ['breakroom', 'writing', 'error']) {
  test(`Nine ${area} visitors have stable distinct positions on web and desktop`, () => {
    const web = Array.from({ length: 9 }, (_, i) => JSON.stringify(layouts[0](area, i)));
    const desktop = Array.from({ length: 9 }, (_, i) => JSON.stringify(layouts[1](area, i)));
    assert.equal(new Set(web).size, 9);
    assert.deepEqual(web, desktop);
    assert.deepEqual(web, Array.from({ length: 9 }, (_, i) => JSON.stringify(layouts[0](area, i))));
  });
}
