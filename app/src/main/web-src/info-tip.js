/* Info tips: a long explanation is shown as a small icon button; a click opens or closes the text under it.
   The icon follows the kind of message: "?" blue (information), warning triangle amber, "!" red (high risk), circular arrow purple (the router restarts).
   window.MatchiTip.make(text, kind)  -> a node: the icon button plus the hidden text. kind is optional: without it kindOf(text) picks one.
   window.MatchiTip.enhance(root)     -> turns every element with a data-tip="kind" attribute under root into the same thing: the element stays
                                         (class, text and translation untouched) and is hidden until its icon button is clicked.
   window.MatchiTip.LONG              -> texts of this length or more are shown as a tip, shorter ones stay as plain lines.
   Text only: the text is put on the page with textContent, never as markup. */
(function () {
  'use strict';
  if (window.MatchiTip) return;
  const LONG = 100;
  const KINDS = {
    info:    { glyph: '?',      label: 'More information' },
    warning: { glyph: '\u26A0\uFE0E', label: 'Warning' },
    danger:  { glyph: '!',      label: 'High risk' },
    restart: { glyph: '\u21BB', label: 'The router restarts' }
  };
  const kindOf = (t) => {
    t = String(t || '');
    if (/highest risk|no signal|may still be off|may lose signal/i.test(t)) return 'danger';
    if (/warning|do not block|disconnects? every|wrong apn|cut off|will be off/i.test(t)) return 'warning';
    if (/restart/i.test(t)) return 'restart';
    return 'info';
  };
  let seq = 0, styled = false;
  function addStyle() {
    if (styled || !document.head) return;
    styled = true;
    const s = document.createElement('style');
    s.textContent = `.mt-tip-btn{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:28px;height:28px;min-width:28px;min-height:0;padding:0;margin:4px 0;border:0;border-radius:8px;font:700 15px/1 system-ui,sans-serif;color:#fff;cursor:pointer;vertical-align:middle}
.mt-tip-btn:focus-visible{outline:2px solid #fff;outline-offset:2px}
.mt-tip-btn[aria-expanded="true"]{box-shadow:0 0 0 2px rgba(255,255,255,.35)}
.mt-tip-info{background:#2a8cf0}.mt-tip-warning{background:#f0a21a;color:#1a1200}.mt-tip-danger{background:#e04458}.mt-tip-restart{background:#8d63e8}
.mt-tip-body{margin:4px 0 8px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.14);border-left-width:4px;background:rgba(255,255,255,.04);line-height:1.45}
.mt-tip-body.mt-tip-info{border-left-color:#2a8cf0}.mt-tip-body.mt-tip-warning{border-left-color:#f0a21a}.mt-tip-body.mt-tip-danger{border-left-color:#e04458}.mt-tip-body.mt-tip-restart{border-left-color:#8d63e8}
.mt-tip-body.mt-tip-info,.mt-tip-body.mt-tip-warning,.mt-tip-body.mt-tip-danger,.mt-tip-body.mt-tip-restart{background-image:none}`;
    document.head.appendChild(s);
  }
  // The button for a text element; the element is the panel.
  function attach(panel, kind) {
    addStyle();
    const k = KINDS[kind] || KINDS.info, kk = KINDS[kind] ? kind : 'info';
    const id = 'mt_tip_' + (++seq);
    panel.id = panel.id || id;
    panel.className = (panel.className ? panel.className + ' ' : '') + 'mt-tip-body mt-tip-' + kk;
    panel.style.display = 'none';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mt-tip-btn mt-tip-' + kk;
    btn.textContent = k.glyph;
    btn.setAttribute('aria-label', k.label);
    btn.setAttribute('title', k.label);
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', panel.id);
    btn.addEventListener('click', (ev) => {
      if (ev && ev.preventDefault) ev.preventDefault();
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.style.display = open ? '' : 'none';
    });
    return btn;
  }
  function make(text, kind, cls) {
    const wrap = document.createElement('div');
    wrap.className = 'mt-tip' + (cls ? ' ' + cls : '');
    const panel = document.createElement('p');
    panel.className = 'net-p';
    panel.textContent = String(text);
    wrap.append(attach(panel, kind || kindOf(text)), panel);
    return wrap;
  }
  function enhance(root) {
    if (!root || !root.querySelectorAll) return;
    const list = root.querySelectorAll('[data-tip]');
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el.getAttribute('data-tip-done') === '1' || !el.parentNode) continue;
      el.setAttribute('data-tip-done', '1');
      const btn = attach(el, el.getAttribute('data-tip'));
      el.parentNode.insertBefore(btn, el);
    }
  }
  window.MatchiTip = { make: make, enhance: enhance, kindOf: kindOf, LONG: LONG, KINDS: KINDS };
})();
