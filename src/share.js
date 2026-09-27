/* Eventually — the organiser's share panel: their event's link and a QR code.
 *
 * WHY THIS EXISTS
 * Removing friction gets you one listing. Giving the organiser something they
 * actually want is what gets you the next one. A page with their own artwork on it,
 * and a QR they can put on a flyer or a story, is a thing they keep — which turns a
 * listing they tolerated into an asset they use.
 *
 * WHY THE PATH IS LOOKED UP AND NOT COMPUTED
 * A city slug is disambiguated against every other city in the build — London,
 * Canada becomes `london-ca` — so only the generator knows an event's real path.
 * Guessing it would send a printed QR code to a 404 for exactly the cities that
 * need the suffix. tools/build-city-pages.js publishes events/native.json for this.
 * Absent from that file is also the honest answer to "is my page live yet?": a
 * just-approved event is not in it until the next rebuild.
 *
 * The QR library is fetched only when someone actually asks for a code, so nobody
 * who never opens this pays for it. If it cannot load, the link still works —
 * the code is the nice-to-have, the URL is the point.
 */
(function (global) {
  'use strict';

  var QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  var indexPromise = null;
  var libPromise = null;

  function loadIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = fetch('/events/native.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
    return indexPromise;
  }

  function loadLib() {
    if (global.QRCode) return Promise.resolve(true);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = QR_LIB;
      s.onload = function () { resolve(!!global.QRCode); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  // The page path for an event, or null when it has not been built yet.
  function pathFor(eventId) {
    return loadIndex().then(function (map) { return (map && map[eventId]) || null; });
  }

  /* Render the panel into `host`. Resolves to the URL, or null if the page does not
     exist yet — the caller decides what to say about that, because "still being
     built" and "not approved yet" read very differently to the person waiting. */
  function panel(host, opts) {
    opts = opts || {};
    var origin = location.origin;
    return pathFor(opts.eventId).then(function (p) {
      if (!p) return null;
      var url = origin + p;
      host.innerHTML =
        '<div class="sh-wrap">' +
          '<div class="sh-qr" id="sh-qr"></div>' +
          '<div class="sh-side">' +
            '<input class="sh-url" readonly value="' + url.replace(/"/g, '&quot;') + '">' +
            '<div class="sh-btns">' +
              '<button type="button" class="sh-btn" id="sh-copy">Copy link</button> ' +
              '<a class="sh-btn sh-dl" id="sh-dl" download="eventually-qr.png" hidden>Download QR</a>' +
            '</div>' +
          '</div>' +
        '</div>';

      var inp = host.querySelector('.sh-url');
      host.querySelector('#sh-copy').onclick = function () {
        var b = this;
        try {
          navigator.clipboard.writeText(url);
          b.textContent = 'Copied';
          setTimeout(function () { b.textContent = 'Copy link'; }, 1800);
        } catch (e) { inp.focus(); inp.select(); }
      };

      loadLib().then(function (ok) {
        var box = host.querySelector('#sh-qr');
        if (!ok || !box) { if (box) box.remove(); return; }
        try {
          /* Drawn at 320 and shown at 160 by the CSS. The picture people DOWNLOAD is
             the one that ends up on a flyer, and a 160px PNG prints as a smudge.
             Level M, not H: nothing is overlaid on this code, and H packs in enough
             extra modules to make it visibly denser — which is the realistic failure,
             a phone struggling with a small busy code, not a torn corner. */
          new global.QRCode(box, {
            text: url, width: 320, height: 320,
            colorDark: '#211A15', colorLight: '#ffffff',
            correctLevel: global.QRCode.CorrectLevel.M
          });
          var cv = box.querySelector('canvas');
          var dl = host.querySelector('#sh-dl');
          if (cv && dl) { dl.href = cv.toDataURL('image/png'); dl.hidden = false; }
        } catch (e) { box.remove(); }
      });

      return url;
    });
  }

  global.EventuallyShare = { panel: panel, pathFor: pathFor };
})(window);
