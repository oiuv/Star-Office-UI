/* DOM-only Markdown for office reading panels; Marked tokenizes, never renders HTML. */
(() => {
    'use strict';
    function render(text, target, {language = 'zh'} = {}) {
        const words = {
            zh: {copy:'复制代码', copied:'已复制', copyError:'复制失败，可直接选中代码复制', table:'表格'},
            en: {copy:'Copy code', copied:'Copied', copyError:'Copy failed; select the code to copy it manually', table:'Table'},
            ja: {copy:'コードをコピー', copied:'コピー済み', copyError:'コピーできません。コードを選択して手動でコピーしてください', table:'表'}
        };
        const labels = () => words[language] || words.zh;
        const element = (tag, className = '', text = '') => {
            const node = document.createElement(tag);
            node.className = className;
            node.textContent = text;
            return node;
        };
        // Marked only tokenizes; all post content becomes DOM nodes or text, never HTML.
        function markdownText(value) {
            const entities = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:'\u00a0',
                copy:'©', reg:'®', trade:'™', mdash:'—', ndash:'–', hellip:'…',
                laquo:'«', raquo:'»', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”'};
            return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, name) => {
                if (name[0] !== '#') return entities[name] ?? match;
                const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
                return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
                    ? String.fromCodePoint(point) : '\ufffd';
            });
        }
        function safeLink(href) {
            try {
                const url = new URL(href);
                return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : '';
            } catch (_) { return ''; }
        }
        function renderInline(tokens, target) {
            for (const token of tokens || []) {
                let node;
                if (['strong', 'em', 'del'].includes(token.type)) {
                    node = element(token.type); renderInline(token.tokens, node);
                } else if (token.type === 'codespan') {
                    node = element('code', '', token.text);
                } else if (token.type === 'br') {
                    node = element('br');
                } else if (token.type === 'link' || token.type === 'image') {
                    const href = safeLink(token.href);
                    node = element(href ? 'a' : 'span', token.type === 'image' ? 'board-image-link' : '');
                    if (href) {
                        node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer';
                        if (token.title) node.title = token.title;
                    }
                    // Images stay as labelled links; opening the board makes no external image requests.
                    if (token.type === 'image') node.textContent = markdownText(token.text || token.href);
                    else renderInline(token.tokens, node);
                } else if (token.tokens) {
                    renderInline(token.tokens, target); continue;
                } else {
                    const value = token.type === 'text' ? markdownText(token.raw ?? token.text) : token.text || token.raw;
                    node = document.createTextNode(value || '');
                }
                target.append(node);
            }
        }
        function renderCode(text) {
            const block = element('div', 'board-code');
            const button = element('button', 'board-copy', labels().copy);
            button.type = 'button';
            const pre = element('pre'), content = element('code', '', text);
            pre.append(content); pre.tabIndex = 0;
            button.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(content.textContent);
                    button.textContent = labels().copied;
                } catch (_) { button.textContent = labels().copyError; }
            });
            block.append(button, pre);
            return block;
        }
        function renderBlocks(tokens, target, tight = false) {
            for (const token of tokens || []) {
                let node;
                if (token.type === 'space' || token.type === 'def') continue;
                if (token.type === 'heading') {
                    node = element('h' + Math.max(1, Math.min(6, token.depth)));
                    renderInline(token.tokens, node);
                } else if (token.type === 'paragraph' || token.type === 'text') {
                    if (tight && token.type === 'text') {
                        if (token.tokens) renderInline(token.tokens, target);
                        else target.append(document.createTextNode(markdownText(token.text)));
                        continue;
                    }
                    node = element('p');
                    if (token.tokens) renderInline(token.tokens, node);
                    else node.textContent = markdownText(token.text);
                } else if (token.type === 'code') {
                    node = renderCode(token.text);
                } else if (token.type === 'blockquote') {
                    node = element('blockquote'); renderBlocks(token.tokens, node);
                } else if (token.type === 'list') {
                    node = element(token.ordered ? 'ol' : 'ul');
                    if (token.ordered) node.start = Number(token.start) || 1;
                    for (const item of token.items) {
                        const li = element('li', item.task ? 'board-task' : '');
                        renderBlocks(item.tokens, li, !token.loose);
                        node.append(li);
                    }
                } else if (token.type === 'checkbox') {
                    node = element('input'); node.type = 'checkbox';
                    node.disabled = true; node.checked = token.checked;
                    node.setAttribute('aria-label', token.checked ? '✓' : '☐');
                } else if (token.type === 'table') {
                    node = element('div', 'board-table');
                    // Keyboard users can scroll a wide table without moving the entire panel.
                    node.tabIndex = 0; node.setAttribute('role', 'region');
                    node.setAttribute('aria-label', labels().table);
                    const table = element('table'), head = element('thead'), body = element('tbody');
                    const row = (cells, tag) => {
                        const tr = element('tr');
                        cells.forEach((cell, i) => {
                            const alignment = ['left', 'center', 'right'].includes(token.align[i]) ? token.align[i] : 'left';
                            const td = element(tag, 'board-align-' + alignment);
                            if (tag === 'th') td.scope = 'col';
                            renderInline(cell.tokens, td); tr.append(td);
                        });
                        return tr;
                    };
                    head.append(row(token.header, 'th'));
                    token.rows.forEach(cells => body.append(row(cells, 'td')));
                    table.append(head, body); node.append(table);
                } else if (token.type === 'hr') {
                    node = element('hr');
                } else {
                    node = element('p', 'board-literal', token.text || token.raw || '');
                }
                target.append(node);
            }
        }
        function renderBody(text, target) {
            const body = element('div', 'board-markdown');
            try {
                renderBlocks(window.marked.lexer(text, {gfm:true}), body);
            } catch (_) {
                body.replaceChildren(element('p', 'board-literal', text));
            }
            target.append(body);
            return body;
        }
        return renderBody(text, target);
    }
    window.OfficeMarkdown = {render};
})();
