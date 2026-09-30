/* Shared by the web office and the standalone desktop page. */
(() => {
    'use strict';
    const notice = document.getElementById('guest-feedback');
    const message = document.getElementById('guest-feedback-message');
    const icon = document.getElementById('guest-feedback-icon');
    const close = document.getElementById('guest-feedback-close');
    let timer;
    function hide() {
        clearTimeout(timer);
        notice.hidden = true;
        message.textContent = '';
    }
    close.addEventListener('click', hide);
    window.GuestFeedback = {
        hide,
        show(text, kind = 'success') {
            clearTimeout(timer);
            notice.dataset.kind = kind;
            icon.textContent = kind === 'error' ? '!' : '✓';
            notice.hidden = false;
            message.textContent = text;
            if (kind !== 'error') {
                timer = setTimeout(() => {
                    if (!notice.contains(document.activeElement)) hide();
                }, 6000);
            }
        }
    };
})();
