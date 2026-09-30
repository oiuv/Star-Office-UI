/* Shared Phaser speech bubbles for the office and Electron views. */
(function (root) {
    'use strict';

    const segmenter = typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    const glyphs = (value) => segmenter
        ? Array.from(segmenter.segment(value), item => item.segment) : Array.from(value);

    // Wrap CJK, emoji and unbroken tool names; prefer spaces for ordinary words.
    function wrapText(value, measure, width) {
        const lines = [];
        for (const paragraph of String(value ?? '').replace(/\r\n?/g, '\n').split('\n')) {
            let line = '';
            for (const glyph of glyphs(paragraph)) {
                if (line && measure(line + glyph) > width) {
                    const space = line.lastIndexOf(' ');
                    if (space > 0 && glyph !== ' ') {
                        lines.push(line.slice(0, space).trimEnd());
                        line = line.slice(space + 1).trimStart();
                    } else {
                        lines.push(line.trimEnd());
                        line = '';
                    }
                }
                if (line || !/^\s+$/u.test(glyph)) line += glyph;
            }
            lines.push(line.trimEnd());
        }
        return lines;
    }

    function position(bubble, anchorX, bottomY) {
        const { width, height, margin } = bubble.__layout;
        const size = bubble.scene.scale.gameSize;
        const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
        bubble.setPosition(
            clamp(anchorX, margin + width / 2, size.width - margin - width / 2),
            clamp(bottomY - height / 2, margin + height / 2, size.height - margin - height / 2)
        );
        return bubble;
    }

    function create(scene, value, anchorX, bottomY, options = {}) {
        const paddingX = 14;
        const paddingY = 9;
        const margin = 10;
        const textWidth = Math.max(1,
            Math.min(options.maxWidth || 320, scene.scale.gameSize.width - 2 * margin) - 2 * paddingX);
        const fontSize = options.fontSize || 14;
        const maxLines = Math.max(1, Math.min(options.maxLines || 8,
            Math.floor((scene.scale.gameSize.height - 2 * margin - 2 * paddingY) / (fontSize + 4))));
        const txt = scene.add.text(0, 0, String(value ?? ''), {
            fontFamily: 'ArkPixel, monospace',
            fontSize: fontSize + 'px',
            color: options.color || '#252525',
            align: 'center',
            lineSpacing: 4,
            wordWrap: {
                callback: (text, object) => {
                    const measure = line => object.context.measureText(line).width;
                    const lines = wrapText(text, measure, textWidth);
                    if (lines.length <= maxLines) return lines;
                    const visible = lines.slice(0, maxLines);
                    const last = glyphs(visible[maxLines - 1]);
                    while (last.length && measure(last.join('') + '…') > textWidth) last.pop();
                    visible[maxLines - 1] = last.join('') + '…';
                    return visible;
                }
            }
        }).setOrigin(0.5);
        const width = Math.max(48, Math.ceil(txt.width) + paddingX * 2);
        const height = Math.max(32, Math.ceil(txt.height) + paddingY * 2);
        const bg = scene.add.rectangle(0, 0, width, height, options.fill ?? 0xffffff, 0.97);
        bg.setStrokeStyle(2, options.stroke ?? 0x4b3a2c);
        const bubble = scene.add.container(0, 0, [bg, txt]);
        bubble.__layout = { width, height, margin };
        bubble.setDepth(options.depth || 2700);
        return position(bubble, anchorX, bottomY);
    }

    function duration(value, minimum = 3200) {
        return Math.min(12000, Math.max(minimum, glyphs(String(value ?? '')).length * 90));
    }

    const api = { create, position, wrapText, duration };
    root.OfficeBubbles = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
