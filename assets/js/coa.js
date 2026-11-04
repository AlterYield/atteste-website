/**
 * Free COA generator (/coa/). Everything happens in this browser tab:
 * the image is read locally, hashed with SHA-256 and drawn into a PDF.
 * No upload, no analytics, no network call — unless ANCHOR_ENDPOINT is set.
 *
 * Depends on (self-hosted, pinned): /assets/js/jspdf-4.2.1.umd.min.js,
 * /assets/js/qrcode-generator-1.4.4.js, /assets/js/coa-core.js.
 */
(function () {
  'use strict';

  /**
   * Timestamp-anchoring hook. OFF while null.
   * When set to a URL, the generator POSTs {"h":"<sha256 hex>"} to it after
   * hashing and prints "Timestamp receipt: <receiptId>" on the PDF if the
   * response is JSON with a string `receiptId`. Only the hash is sent — never
   * the image or any other field.
   * Turning it on also needs the endpoint's origin added to connect-src in
   * _headers (the site CSP blocks other origins), and the /coa/ privacy copy
   * updated to say the hash is sent.
   */
  var ANCHOR_ENDPOINT = null;

  var QR_MAX_MODULES = 65;   // QR version 12: ~0.46 mm per module at 30 mm
  var QR_SIZE_MM = 30;
  var IMG_MAX_PX = 1800;

  var COA = window.AttesteCOA;
  var form = document.getElementById('coa-form');
  if (!COA || !form) return;

  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $('coa-status');
  var fileInput = $('coa-image');
  var previewImg = $('coa-preview-img');
  var previewHash = $('coa-preview-hash');
  var submitBtn = $('coa-submit');
  var done = $('coa-done');

  var state = { file: null, bytes: null, hash: null, dataUrl: null, imgW: 0, imgH: 0 };

  // ── Medium presets (/coa/?for=prints from the medium guides) ─────────────
  var PRESETS = {
    painting: { medium: 'e.g. Oil on linen', dims: 'e.g. 90 × 120 cm (unframed)', edition: 'Unique', statement: 'Signature location, ground and support, varnish, framing, exhibition history.' },
    photography: { medium: 'e.g. Archival pigment print on Hahnemühle Photo Rag', dims: 'e.g. Image 40 × 60 cm, sheet 50 × 70 cm', edition: 'e.g. 3/10 + 2 AP', statement: 'Capture date, print date, who printed it, paper, the full edition across all sizes.' },
    prints: { medium: 'e.g. Etching and aquatint on Somerset paper', dims: 'e.g. Plate 30 × 40 cm, sheet 50 × 60 cm', edition: 'e.g. 12/50, or AP 2/5', statement: 'Printer or workshop, chop marks, total edition incl. AP/PP/BAT, plate cancelled or not.' },
    sculpture: { medium: 'e.g. Bronze, lost-wax cast, brown patina', dims: 'e.g. 45 × 20 × 18 cm, 9.5 kg', edition: 'e.g. Cast 3/8', statement: 'Foundry, casting year, patina, foundry mark and where it sits, base, installation notes.' }
  };
  var preset = PRESETS[new URLSearchParams(location.search).get('for') || ''];
  if (preset) {
    $('coa-medium').placeholder = preset.medium;
    $('coa-dims').placeholder = preset.dims;
    $('coa-edition').placeholder = preset.edition;
    $('coa-statement').placeholder = preset.statement;
  }
  $('coa-date').textContent = COA.isoToday();

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = 'coa-status' + (isError ? ' error' : '');
  }

  // ── Image: hash the ORIGINAL bytes; downscale a copy only for the PDF ─────
  fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    state = { file: null, bytes: null, hash: null, dataUrl: null, imgW: 0, imgH: 0 };
    previewImg.hidden = true;
    previewHash.textContent = '';
    if (!f) return;
    if (f.size > 60 * 1024 * 1024) { setStatus('That file is over 60 MB. Please choose a smaller image.', true); return; }
    setStatus('Reading the image on this device…');
    f.arrayBuffer().then(function (buf) {
      state.file = f;
      state.bytes = buf;
      return COA.sha256Hex(buf);
    }).then(function (h) {
      state.hash = h;
      previewHash.textContent = 'SHA-256: ' + h;
      return loadForPdf(f);
    }).then(function (img) {
      state.dataUrl = img.dataUrl; state.imgW = img.w; state.imgH = img.h;
      previewImg.src = img.dataUrl;
      previewImg.hidden = false;
      setStatus('Image ready. It has not left this device.');
    }).catch(function (e) {
      state.dataUrl = null;
      setStatus(e && e.userMessage ? e.userMessage : 'This browser could not read that image. Please export it as JPEG or PNG and try again.', true);
    });
  });

  function loadForPdf(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('read')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () {
          var err = new Error('decode');
          err.userMessage = 'This browser cannot display that image format (HEIC and RAW often fail). Export it as JPEG or PNG and choose it again.';
          reject(err);
        };
        img.onload = function () {
          var scale = Math.min(1, IMG_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
          var w = Math.max(1, Math.round(img.naturalWidth * scale));
          var h = Math.max(1, Math.round(img.naturalHeight * scale));
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve({ dataUrl: c.toDataURL('image/jpeg', 0.9), w: w, h: h });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ── QR density check, shared with fitPayload ─────────────────────────────
  function qrFits(url) {
    var levels = ['M', 'L'];
    for (var i = 0; i < levels.length; i++) {
      try {
        var q = window.qrcode(0, levels[i]);
        q.addData(url, 'Byte');
        q.make();
        if (q.getModuleCount() <= QR_MAX_MODULES) return levels[i];
      } catch (e) { /* too long for any version at this level */ }
    }
    return null;
  }

  // ── Optional timestamp anchoring ─────────────────────────────────────────
  function anchor(h) {
    if (!ANCHOR_ENDPOINT) return Promise.resolve(null);
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
    return fetch(ANCHOR_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ h: h }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && typeof j.receiptId === 'string' ? j.receiptId.slice(0, 120) : null; })
      .catch(function () { return null; })
      .then(function (v) { clearTimeout(timer); return v; });
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    if (!state.hash || !state.dataUrl) { setStatus('Choose an image of the work first (JPEG or PNG).', true); return; }
    if (!window.jspdf || !window.qrcode) { setStatus('The PDF tools did not load. Reload the page and try again.', true); return; }

    var fields = {
      h: state.hash,
      t: $('coa-title').value, a: $('coa-artist').value, y: $('coa-year').value,
      m: $('coa-medium').value, d: $('coa-dims').value, e: $('coa-edition').value,
      i: COA.isoToday()
    };
    var record = COA.buildRecord(fields);
    var statement = $('coa-statement').value.trim();
    var fit = COA.fitPayload(record, qrFits);

    submitBtn.disabled = true;
    setStatus('Building your certificate…');
    anchor(record.h).then(function (receipt) {
      var doc = buildPdf(record, statement, fit, receipt);
      doc.save(fileName(record));
      // Consent-gated and carries no certificate data. See consent.js.
      if (window.attesteConsent) window.attesteConsent.track('CoaDownload');
      showDone(record, fit, receipt);
      setStatus('Done. Your PDF has downloaded.');
    }).catch(function (e) {
      setStatus('Something went wrong building the PDF: ' + (e && e.message ? e.message : e), true);
    }).then(function () { submitBtn.disabled = false; });
  });

  function fileName(rec) {
    var slug = rec.t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'artwork';
    return 'COA-' + slug + '-' + rec.h.slice(0, 8) + '.pdf';
  }

  function showDone(rec, fit, receipt) {
    $('coa-done-hash').textContent = rec.h;
    var link = $('coa-done-claim');
    link.href = fit.url;
    var note = $('coa-done-note');
    var labels = { d: 'dimensions', e: 'edition', m: 'medium', y: 'year', i: 'issue date' };
    var msgs = [];
    if (fit.dropped.length) msgs.push('To keep the QR code scannable at 30 mm, it leaves out: ' + fit.dropped.map(function (k) { return labels[k]; }).join(', ') + '. The PDF still prints them.');
    if (!fit.level) msgs.push('Your title and artist name are long, so the QR code is dense. Test-scan the printed certificate; shorten the title if it does not scan.');
    if (receipt) msgs.push('Timestamp receipt: ' + receipt);
    note.textContent = msgs.join(' ');
    done.hidden = false;
    done.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── PDF ──────────────────────────────────────────────────────────────────
  // Standard PDF fonts cover Western European text (WinAnsi). Anything else is
  // reduced to its base letter where possible, so the PDF never shows mojibake.
  var CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  function pdfText(s) {
    var out = '';
    var str = String(s || '').normalize('NFC');
    for (var i = 0; i < str.length; i++) {
      var ch = str[i], c = ch.charCodeAt(0);
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.indexOf(ch) !== -1) { out += ch; continue; }
      var base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      out += /^[\x20-\x7e]+$/.test(base) ? base : (c === 0x0a ? ' ' : '?');
    }
    return out;
  }

  var INK = [26, 26, 46], MUTED = [90, 90, 120], GOLD = [168, 134, 74], GOLD_LIGHT = [201, 169, 110], CREAM = [250, 248, 245];

  function buildPdf(rec, statement, fit, receipt) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    var W = 210, H = 297, CX = W / 2;
    doc.setProperties({
      title: pdfText('Certificate of Authenticity — ' + rec.t),
      author: pdfText(rec.a),
      subject: 'Artist-issued certificate of authenticity. Image SHA-256 ' + rec.h,
      creator: 'Attesté COA generator (atteste.art/coa)'
    });

    // Paper + double gold rule
    doc.setFillColor.apply(doc, CREAM); doc.rect(0, 0, W, H, 'F');
    doc.setDrawColor.apply(doc, GOLD_LIGHT);
    doc.setLineWidth(0.7); doc.rect(10, 10, W - 20, H - 20);
    doc.setLineWidth(0.2); doc.rect(13, 13, W - 26, H - 26);

    var y = 27;
    spaced(doc, 'CERTIFICATE OF AUTHENTICITY', CX, y, 'helvetica', 'bold', 9.5, GOLD, 1.1);
    y += 6;
    doc.setFont('times', 'italic'); doc.setFontSize(10); doc.setTextColor.apply(doc, MUTED);
    doc.text("Issued by the artist as their own statement of record", CX, y, { align: 'center' });

    // Title (max 2 lines) and artist
    y += 11;
    doc.setFont('times', 'bolditalic'); doc.setFontSize(24); doc.setTextColor.apply(doc, INK);
    var tLines = doc.splitTextToSize(pdfText(rec.t), 160).slice(0, 2);
    doc.text(tLines, CX, y, { align: 'center' });
    y += tLines.length * 9.2;
    doc.setFont('times', 'normal'); doc.setFontSize(14);
    doc.text('by ' + pdfText(rec.a), CX, y, { align: 'center' });

    // Measure the flowing blocks first so the image takes whatever room is left.
    var details = [['Year', rec.y], ['Medium', fieldVal('coa-medium')],
                   ['Dimensions', fieldVal('coa-dims')], ['Edition', fieldVal('coa-edition')]];
    var colX = [28, 112], colW = 74, LINE = 4.6;
    doc.setFont('times', 'normal'); doc.setFontSize(11);
    var cells = details.map(function (p) { return doc.splitTextToSize(pdfText(p[1] || '—'), colW).slice(0, 2); });
    var rowH = [0, 1].map(function (r) { return 5 + Math.max(cells[r * 2].length, cells[r * 2 + 1].length) * LINE + 3.5; });
    var sLines = [];
    if (statement) {
      doc.setFont('times', 'italic'); doc.setFontSize(10.5);
      sLines = doc.splitTextToSize(pdfText('“' + statement + '”'), 154);
      if (sLines.length > 5) { sLines = sLines.slice(0, 5); sLines[4] = sLines[4].replace(/\s*\S*$/, '') + '…'; }
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6);
    var decl = doc.splitTextToSize(pdfText('I, ' + rec.a + ', state that I created the work described above and that the details on this certificate are true to the best of my knowledge. This certificate is my own statement of record.'), 154).slice(0, 3);

    var sigY = 226;
    var declTop = sigY - 12 - decl.length * 3.7;
    var below = 9 + rowH[0] + rowH[1] + (sLines.length ? sLines.length * LINE + 4 : 0) + 3;
    var boxTop = y + 6, boxW = 140;
    var boxH = Math.max(40, Math.min(110, declTop - below - boxTop));
    var ratio = Math.min(boxW / state.imgW, boxH / state.imgH);
    var iw = state.imgW * ratio, ih = state.imgH * ratio;
    var ix = CX - iw / 2, iy = boxTop + (boxH - ih) / 2;
    doc.addImage(state.dataUrl, 'JPEG', ix, iy, iw, ih, undefined, 'FAST');
    doc.setDrawColor.apply(doc, GOLD_LIGHT); doc.setLineWidth(0.25);
    doc.rect(ix - 1.5, iy - 1.5, iw + 3, ih + 3);
    y = boxTop + boxH + 9;

    // Details grid (2 × 2)
    for (var r = 0; r < 2; r++) {
      for (var c = 0; c < 2; c++) {
        spaced(doc, details[r * 2 + c][0].toUpperCase(), colX[c], y, 'helvetica', 'bold', 7, GOLD, 0.6, 'left');
        doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor.apply(doc, INK);
        doc.text(cells[r * 2 + c], colX[c], y + 5);
      }
      y += rowH[r];
    }

    // Statement (max 5 lines)
    if (sLines.length) {
      y += 1;
      doc.setFont('times', 'italic'); doc.setFontSize(10.5); doc.setTextColor.apply(doc, INK);
      doc.text(sLines, 28, y);
      y += sLines.length * LINE + 3;
    }

    // Declaration + signature lines (fixed position, so they never collide)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); doc.setTextColor.apply(doc, MUTED);
    doc.text(decl, 28, Math.max(declTop, y + 2));
    doc.setDrawColor.apply(doc, INK); doc.setLineWidth(0.25);
    doc.line(28, sigY, 112, sigY); doc.line(128, sigY, 182, sigY);
    doc.setFontSize(7.5);
    doc.text("Artist's signature", 28, sigY + 4);
    doc.text('Date', 128, sigY + 4);

    // Bottom band: fingerprint (left) + QR (right)
    var bandY = 239;
    doc.setDrawColor.apply(doc, GOLD_LIGHT); doc.setLineWidth(0.2); doc.line(24, bandY - 3, 186, bandY - 3);
    spaced(doc, 'IMAGE FINGERPRINT (SHA-256)', 28, bandY + 2, 'helvetica', 'bold', 7, GOLD, 0.6, 'left');
    doc.setFont('courier', 'normal'); doc.setFontSize(8.6); doc.setTextColor.apply(doc, INK);
    doc.text(rec.h.slice(0, 32), 28, bandY + 7);
    doc.text(rec.h.slice(32), 28, bandY + 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); doc.setTextColor.apply(doc, MUTED);
    var ty = bandY + 16.5;
    doc.text('Issued ' + rec.i, 28, ty);
    if (receipt) { ty += 4; doc.text(pdfText('Timestamp receipt: ' + receipt), 28, ty); }
    ty += 4.5;
    var expl = doc.splitTextToSize('This fingerprint identifies the exact image file this certificate was issued with. Any change to that file gives a different fingerprint, so keep the original file.', 112);
    doc.text(expl, 28, ty);

    var qx = 152, qy = bandY + 0.5;
    drawQr(doc, fit.url, fit.level || 'L', qx, qy, QR_SIZE_MM);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor.apply(doc, INK);
    doc.text(pdfText('Register this work on Attesté'), qx + QR_SIZE_MM / 2, qy + QR_SIZE_MM + 3.6, { align: 'center' });

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2); doc.setTextColor.apply(doc, MUTED);
    doc.text(pdfText('Created with the free COA generator at atteste.art/coa. Attesté did not examine the work and does not check this statement.'), CX, 279, { align: 'center' });
    return doc;
  }

  function fieldVal(id) { var el = $(id); return el ? el.value.replace(/\s+/g, ' ').trim() : ''; }

  function spaced(doc, s, x, y, font, style, size, color, cs, align) {
    doc.setFont(font, style); doc.setFontSize(size); doc.setTextColor.apply(doc, color);
    var w = doc.getTextWidth(s) + cs * (s.length - 1);
    var left = align === 'left' ? x : x - w / 2;
    doc.text(s, left, y, { charSpace: cs });
  }

  function drawQr(doc, text, level, x, y, size) {
    var q = window.qrcode(0, level);
    q.addData(text, 'Byte');
    q.make();
    var n = q.getModuleCount(), cell = size / n;
    doc.setFillColor(255, 255, 255);
    doc.rect(x - 2, y - 2, size + 4, size + 4, 'F');
    doc.setFillColor.apply(doc, INK);
    for (var r = 0; r < n; r++) {
      var c = 0;
      while (c < n) {
        if (!q.isDark(r, c)) { c++; continue; }
        var start = c;
        while (c < n && q.isDark(r, c)) c++;
        // Slight overlap avoids hairline gaps between modules in some viewers.
        doc.rect(x + start * cell, y + r * cell, (c - start) * cell + 0.02, cell + 0.02, 'F');
      }
    }
  }
})();
