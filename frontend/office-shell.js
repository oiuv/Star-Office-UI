/* Controls for the fullscreen office. Game state stays in index.html. */
(() => {
    'use strict';
    const words = {
        zh: { memo: '昨日小记', guests: '访客列表', decor: '装修房间', stats: '活动档案', more: '更多设置', close: '关闭', language: '语言', view: '房间视野', state: '手动状态', tools: '办公室工具' },
        en: { memo: 'Journal', guests: 'Visitors', decor: 'Decorate', stats: 'Activity', more: 'More settings', close: 'Close', language: 'Language', view: 'Room view', state: 'Manual status', tools: 'Office tools' },
        ja: { memo: '昨日のメモ', guests: '訪問者', decor: '模様替え', stats: '活動記録', more: 'その他の設定', close: '閉じる', language: '言語', view: '部屋の表示', state: '手動ステータス', tools: 'オフィスツール' }
    };
    const panels = [...document.querySelectorAll('.office-panel[popover]')];
    const drawer = document.getElementById('asset-drawer');
    const dock = document.getElementById('office-dock');
    let drawerReturnFocus = null;
    function closePanels() {
        panels.forEach(panel => { if (panel.matches(':popover-open')) panel.hidePopover(); });
    }
    panels.forEach(panel => {
        panel.addEventListener('toggle', event => {
            document.querySelectorAll('[popovertarget="' + panel.id + '"]').forEach(button => {
                if (button.getAttribute('popovertargetaction') !== 'hide') {
                    button.setAttribute('aria-expanded', String(event.newState === 'open'));
                }
            });
        });
    });
    window.OfficeShell = {
        translate(lang) {
            const labels = words[lang] || words.zh;
            document.querySelectorAll('[data-office-text]').forEach(el => {
                el.textContent = labels[el.dataset.officeText];
            });
            document.querySelectorAll('[data-office-label]').forEach(el => {
                el.setAttribute('aria-label', labels[el.dataset.officeLabel]);
                el.title = labels[el.dataset.officeLabel];
            });
        },
        drawerChanged(open) {
            if (open) {
                closePanels();
                drawerReturnFocus = document.activeElement;
            }
            drawer.inert = !open;
            drawer.setAttribute('aria-hidden', String(!open));
            drawer.setAttribute('aria-modal', String(open));
            document.getElementById('main-stage').inert = open;
            dock.inert = open;
            document.getElementById('btn-open-drawer').setAttribute('aria-expanded', String(open));
            if (open) document.getElementById('btn-close-drawer').focus();
            else if (drawerReturnFocus?.isConnected) {
                drawerReturnFocus.focus();
                drawerReturnFocus = null;
            }
        }
    };
    document.addEventListener('keydown', event => {
        if (!drawer.classList.contains('open')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            toggleAssetDrawer(false);
        } else if (event.key === 'Tab') {
            const focusable = [...drawer.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex="0"]')]
                .filter(el => !el.disabled && el.getClientRects().length);
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first?.focus();
            }
        }
    });
})();
