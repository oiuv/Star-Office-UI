/* Controls for the fullscreen office. Game state stays in index.html. */
(() => {
    'use strict';
    const words = {
        zh: { memo: '昨日小记', guests: '访客列表', decor: '装修房间', stats: '活动档案', more: '更多设置', close: '关闭', language: '语言', view: '房间视野', state: '手动状态', tools: '办公室工具', menuHint: '点击办公室名称展开菜单', openMenu: '展开办公室菜单', closeMenu: '收起办公室菜单' },
        en: { memo: 'Journal', guests: 'Visitors', decor: 'Decorate', stats: 'Activity', more: 'More settings', close: 'Close', language: 'Language', view: 'Room view', state: 'Manual status', tools: 'Office tools', menuHint: 'Click the office name to open the menu', openMenu: 'Open office menu', closeMenu: 'Close office menu' },
        ja: { memo: '昨日のメモ', guests: '訪問者', decor: '模様替え', stats: '活動記録', more: 'その他の設定', close: '閉じる', language: '言語', view: '部屋の表示', state: '手動ステータス', tools: 'オフィスツール', menuHint: 'オフィス名を押すとメニューが開きます', openMenu: 'メニューを開く', closeMenu: 'メニューを閉じる' }
    };
    const panels = [...document.querySelectorAll('.office-panel[popover]')];
    const drawer = document.getElementById('asset-drawer');
    const dock = document.getElementById('office-dock');
    const plaque = document.getElementById('office-menu-toggle');
    let labels = words.zh;
    let drawerReturnFocus = null;
    function closePanels() {
        panels.forEach(panel => { if (panel.matches(':popover-open')) panel.hidePopover(); });
    }
    function closeMenu() {
        if (dock.matches(':popover-open')) dock.hidePopover();
    }
    function updateMenuToggle() {
        const open = dock.matches(':popover-open');
        plaque.setAttribute('aria-expanded', String(open));
        plaque.title = open ? labels.closeMenu : labels.openMenu;
    }
    dock.addEventListener('beforetoggle', event => {
        if (event.newState === 'open') closePanels();
    });
    dock.addEventListener('toggle', updateMenuToggle);
    dock.addEventListener('click', event => {
        const trigger = event.target.closest('button[popovertarget]');
        if (trigger) {
            event.preventDefault();
            closeMenu();
            const panel = document.getElementById(trigger.getAttribute('popovertarget'));
            panel.showPopover();
            panel.querySelector('.office-panel-close').focus();
        } else if (event.target.closest('a')) {
            closeMenu();
        }
    });
    panels.forEach(panel => {
        panel.addEventListener('beforetoggle', event => {
            // Panel invokers live in the collapsed menu; return to its visible nameplate instead.
            if (event.newState === 'closed' && panel.contains(document.activeElement)) plaque.focus();
        });
        panel.addEventListener('toggle', event => {
            document.querySelectorAll('[popovertarget="' + panel.id + '"]').forEach(button => {
                if (button.getAttribute('popovertargetaction') !== 'hide') {
                    button.setAttribute('aria-expanded', String(event.newState === 'open'));
                }
            });
        });
    });
    window.OfficeShell = {
        setTitle(title) {
            document.getElementById('office-plaque-title').textContent = title;
        },
        positionAtRoomBottom(rect) {
            if (!rect || !(rect.width > 0 && rect.height > 0)) return;
            const bottom = Math.max(14, Math.round(window.innerHeight - rect.top - rect.height + 14));
            document.documentElement.style.setProperty('--office-room-bottom', bottom + 'px');
            const status = document.getElementById('status-text');
            const plaqueRect = plaque.getBoundingClientRect();
            if (rect.width < 760) {
                status.style.bottom = (window.innerHeight - plaqueRect.top + 8) + 'px';
            } else {
                status.style.maxWidth = Math.max(120, Math.floor(plaqueRect.left - rect.left - 28)) + 'px';
            }
        },
        translate(lang) {
            labels = words[lang] || words.zh;
            document.querySelectorAll('[data-office-text]').forEach(el => {
                el.textContent = labels[el.dataset.officeText];
            });
            document.querySelectorAll('[data-office-label]').forEach(el => {
                el.setAttribute('aria-label', labels[el.dataset.officeLabel]);
                el.title = labels[el.dataset.officeLabel];
            });
            updateMenuToggle();
        },
        drawerChanged(open) {
            if (open) {
                drawerReturnFocus = plaque;
                closePanels();
                closeMenu();
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
