/* Info tips: a long explanation is shown as a small icon button; a click opens or closes the text under it.
   Small soft-tinted round icon (line drawing) that follows the kind of message: info circle blue, warning triangle amber, alert circle red (high risk),
   circular arrow purple (the router restarts). The opened text is a plain thin box.
   window.MatchiTip.make(text, kind)  -> a node: the icon button plus the hidden text. kind is optional: without it kindOf(text) picks one.
   window.MatchiTip.enhance(root)     -> turns every element with a data-tip="kind" attribute under root into the same thing: the element stays
                                         (class, text and translation untouched) and is hidden until its icon button is clicked.
   window.MatchiTip.LONG              -> texts of this length or more are shown as a tip, shorter ones stay as plain lines.
   Text only: the text is put on the page with textContent, never as markup. */
(function () {
  'use strict';
  if (window.MatchiTip) return;
  const LONG = 100;
  // Line icons on a 24 x 24 grid: [tag, attributes]. Drawn with createElementNS; where that is missing a plain character stands in.
  const DOT = ['circle', { cx: 12, cy: 16.4, r: 0.7, fill: 'currentColor' }];
  const KINDS = {
    info:    { glyph: 'i',      label: 'More information', shapes: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v5.5' }], ['circle', { cx: 12, cy: 7.8, r: 0.7, fill: 'currentColor' }]] },
    warning: { glyph: '\u26A0\uFE0E', label: 'Warning', shapes: [['path', { d: 'M12 4 21 19H3Z' }], ['path', { d: 'M12 10v4' }], DOT] },
    danger:  { glyph: '!',      label: 'High risk', shapes: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7.5v5' }], DOT] },
    restart: { glyph: '\u21BB', label: 'The router restarts', shapes: [['path', { d: 'M20 12a8 8 0 1 1-2.6-5.9' }], ['path', { d: 'M20 4v4.5h-4.5' }]] }
  };
  const NS = 'http://www.w3.org/2000/svg';
  function icon(k) {
    if (!document.createElementNS) return document.createTextNode(k.glyph);
    const svg = document.createElementNS(NS, 'svg');
    for (const [n, v] of [['width', 12], ['height', 12], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', 2], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]) svg.setAttribute(n, String(v));
    for (const [tag, at] of k.shapes) { const e = document.createElementNS(NS, tag); for (const n of Object.keys(at)) e.setAttribute(n, String(at[n])); svg.appendChild(e); }
    return svg;
  }
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
    s.textContent = `.mt-tip-btn{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:19px;height:19px;min-width:19px;min-height:0;padding:0;margin:2px 0;border:0;border-radius:50%;cursor:pointer;background:var(--tb);color:var(--tc);line-height:0}
.mt-tip-btn svg{display:block}
.mt-tip-btn:hover{background:var(--th)}
.mt-tip-btn:focus-visible{outline:2px solid var(--tc);outline-offset:2px}
.mt-tip-btn[aria-expanded="true"]{background:var(--th)}
.mt-tip-info{--tc:#5aa9ff;--tb:rgba(90,169,255,.16);--th:rgba(90,169,255,.3)}
.mt-tip-warning{--tc:#f2b13a;--tb:rgba(242,177,58,.16);--th:rgba(242,177,58,.3)}
.mt-tip-danger{--tc:#ff6b7d;--tb:rgba(255,107,125,.16);--th:rgba(255,107,125,.3)}
.mt-tip-restart{--tc:#a98bff;--tb:rgba(169,139,255,.16);--th:rgba(169,139,255,.3)}
.mt-tip-body{box-sizing:border-box;margin:4px 0 8px!important;padding:8px 11px!important;border:1px solid rgba(255,255,255,.13)!important;border-radius:8px;background:rgba(255,255,255,.03)!important;color:var(--mut,#aab6c8)!important;font-size:12.5px!important;line-height:1.45!important}`;
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
    btn.appendChild(icon(k));
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
