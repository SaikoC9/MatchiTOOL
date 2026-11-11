/* Safe HTML helper (review item 20). Builds markup where every interpolated value is escaped unless it is marked as already-safe markup.
     const { html, raw, esc, setHtml } = window.MT_html;
     setHtml(box, html`<div class="row">${name}</div>`);                 // name is escaped
     setHtml(box, html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`); // nested html`` and arrays are kept as markup
     setHtml(box, raw('<b>fixed text</b>'));                              // raw() = "I wrote this literal myself"
   setHtml() escapes a plain string, so a forgotten html`` can show ugly text but cannot inject markup.
   scripts/check_innerhtml.js fails the build when a new innerHTML site appears that is not static, not escaped and not in its reviewed list. */
(function () {
  const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => MAP[c]);
  function SafeHtml(s) { this.s = s; }
  SafeHtml.prototype.toString = function () { return this.s; };
  const raw = (s) => new SafeHtml(String(s == null ? '' : s));
  const part = (v) => {
    if (v instanceof SafeHtml) return v.s;
    if (Array.isArray(v)) return v.map(part).join('');
    if (v === false || v == null) return '';
    return esc(v);
  };
  function html(strings) {
    let out = '';
    for (let i = 0; i < strings.length; i++) { out += strings[i]; if (i + 1 < strings.length) out += part(arguments[i + 1]); }
    return new SafeHtml(out);
  }
  const setHtml = (el, v) => { if (el) el.innerHTML = v instanceof SafeHtml ? v.s : esc(v); return el; };
  window.MT_html = Object.freeze({ esc, raw, html, setHtml, isSafe: (v) => v instanceof SafeHtml });
})();
