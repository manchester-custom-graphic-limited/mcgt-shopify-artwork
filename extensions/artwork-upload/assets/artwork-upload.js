/*
 * Artwork upload block (MCGT). Flow per chosen file:
 *   1. GET  <shop>/apps/mcgt-artwork/ticket   — Shopify app proxy; Shopify signs the request,
 *      the backend checks the signature and returns a one-time, 10-minute upload ticket.
 *   2. PUT  <api>/upload?t=<ticket>&name=…   — the raw image, straight to the backend.
 *   3. The returned id goes into the cart line's hidden `_artwork_id` property.
 * Unordered uploads are deleted by the backend after about an hour, so an upload older than
 * STALE_MS is cleared and the customer is asked to choose the file again.
 */
(function () {
  'use strict';

  var STALE_MS = 50 * 60 * 1000;
  var TYPES = { 'image/png': true, 'image/jpeg': true };

  function init(root) {
    if (root.dataset.ready) return;
    root.dataset.ready = '1';

    var $ = function (sel) { return root.querySelector(sel); };
    var fileInput = $('.mcgt-artwork__file');
    var drop = $('.mcgt-artwork__drop');
    var chosen = $('.mcgt-artwork__chosen');
    var thumb = $('.mcgt-artwork__thumb');
    var nameEl = $('.mcgt-artwork__name');
    var statusEl = $('.mcgt-artwork__status');
    var bar = $('.mcgt-artwork__progress');
    var errEl = $('.mcgt-artwork__error');
    var propName = $('.mcgt-artwork__prop-name');
    var propId = $('.mcgt-artwork__prop-id');
    var required = root.dataset.required === 'true';
    var maxBytes = Number(root.dataset.maxMb || 20) * 1024 * 1024;

    var state = { id: '', uploadedAt: 0, busy: false, xhr: null, url: '' };

    // Themes other than Horizon name the form differently: fall back to the section's
    // add-to-cart form and point our hidden inputs at it.
    var form = document.getElementById(root.dataset.formId);
    if (!form) {
      var section = root.closest('[id^="shopify-section-"]') || document;
      form = section.querySelector('form[action*="/cart/add"]');
      if (form) {
        if (!form.id) form.id = 'mcgt-artwork-form-' + Math.random().toString(36).slice(2);
        root.querySelectorAll('input[type=hidden]').forEach(function (i) { i.setAttribute('form', form.id); });
      }
    }

    function showError(msg) {
      errEl.textContent = msg || '';
      errEl.hidden = !msg;
    }

    function setProps(id, name) {
      propId.value = id || '';
      propName.value = name || '';
      propId.disabled = propName.disabled = !id;     // disabled inputs stay out of the cart
    }

    function reset() {
      if (state.xhr) state.xhr.abort();
      if (state.url) URL.revokeObjectURL(state.url);
      state = { id: '', uploadedAt: 0, busy: false, xhr: null, url: '' };
      setProps('', '');
      fileInput.value = '';
      chosen.hidden = true;
      drop.hidden = false;
      bar.hidden = true;
      root.classList.remove('is-busy', 'is-done');
    }

    function getTicket() {
      return fetch(root.dataset.proxy + '/ticket', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (d) {
            if (!r.ok || !d.ticket) throw new Error(d.error || 'Upload is unavailable right now. Please try again.');
            return d.ticket;
          });
        });
    }

    function put(file, ticket) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        state.xhr = xhr;
        xhr.open('PUT', root.dataset.api + '/upload?t=' + encodeURIComponent(ticket) +
          '&name=' + encodeURIComponent(file.name.slice(0, 100)));
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) bar.value = Math.round((e.loaded / e.total) * 100);
        };
        xhr.onload = function () {
          var d = {};
          try { d = JSON.parse(xhr.responseText); } catch (e) { /* keep {} */ }
          if (xhr.status === 200 && d.id) resolve(d.id);
          else reject(new Error(d.error || 'Upload failed. Please try again.'));
        };
        xhr.onerror = function () { reject(new Error('Upload failed — check your connection and try again.')); };
        xhr.onabort = function () { reject(new Error('')); };
        xhr.send(file);
      });
    }

    function handle(file) {
      showError('');
      if (!file) return;
      if (!TYPES[file.type]) return showError('Please choose a PNG or JPG image.');
      if (file.size > maxBytes) return showError('That image is over 20MB. Please choose a smaller file.');

      reset();
      state.busy = true;
      state.url = URL.createObjectURL(file);
      thumb.src = state.url;
      nameEl.textContent = file.name;
      statusEl.textContent = 'Uploading…';
      bar.value = 0;
      bar.hidden = false;
      drop.hidden = true;
      chosen.hidden = false;
      root.classList.add('is-busy');

      getTicket()
        .then(function (ticket) { return put(file, ticket); })
        .then(function (id) {
          state.id = id;
          state.uploadedAt = Date.now();
          state.busy = false;
          state.xhr = null;
          setProps(id, file.name.slice(0, 100));
          statusEl.textContent = 'Uploaded ✓';
          bar.hidden = true;
          root.classList.remove('is-busy');
          root.classList.add('is-done');
        })
        .catch(function (e) {
          var msg = e && e.message;
          reset();
          if (msg) showError(msg);
        });
    }

    fileInput.addEventListener('change', function () { handle(fileInput.files && fileInput.files[0]); });
    $('.mcgt-artwork__remove').addEventListener('click', function () { reset(); showError(''); });

    ['dragover', 'dragenter'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function () { drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      handle(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });

    // Gate add-to-cart. Capture phase on document runs before the theme's own submit
    // handler, so stopping here keeps an artwork-less line out of the cart.
    document.addEventListener('submit', function (e) {
      if (!form || e.target !== form) return;
      var msg = '';
      if (state.busy) msg = 'Please wait for your artwork to finish uploading.';
      else if (state.id && Date.now() - state.uploadedAt > STALE_MS) {
        reset();
        msg = 'Your upload has expired. Please choose your image again.';
      } else if (required && !state.id) msg = 'Please upload your artwork first.';
      if (!msg) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      showError(msg);
      root.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, true);
  }

  function boot() { document.querySelectorAll('.mcgt-artwork').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  // Theme editor re-renders blocks in place.
  document.addEventListener('shopify:section:load', boot);
  document.addEventListener('shopify:block:select', boot);
})();
