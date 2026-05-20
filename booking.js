// Wisteria Counseling — custom booking flow
// Talks to /api/event-type, /api/slots, /api/book (Cloudflare Pages Functions
// that proxy to Cal.com). No API key in client code.

(() => {
  // ---------- year stamp ----------
  const yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  // ---------- sticky top bar elevation ----------
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    const syncTopbar = () => topbar.classList.toggle('is-scrolled', window.scrollY > 8);
    let topbarTicking = false;
    window.addEventListener('scroll', () => {
      if (!topbarTicking) {
        requestAnimationFrame(() => { syncTopbar(); topbarTicking = false; });
        topbarTicking = true;
      }
    }, { passive: true });
    syncTopbar();
  }

  // ---------- timezone ----------
  const tz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
    catch { return 'America/New_York'; }
  })();

  // ---------- state ----------
  const today = startOfDay(new Date());
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();          // 0-indexed
  let eventType = null;                      // { title, lengthInMinutes, customFields, ... }
  let monthSlots = {};                       // { "YYYY-MM-DD": [{ startISO }] }
  let selectedDateKey = null;                // "YYYY-MM-DD"
  let selectedSlot = null;                   // { startISO }

  // ---------- elements ----------
  const $ = (sel) => document.querySelector(sel);
  const stage = $('#booking-stage');
  const panelPick = $('#panel-pick');
  const errorBox = $('#booking-error');
  const monthLabel = $('#cal-month');
  const grid = $('#cal-grid');
  const prevBtn = $('#prev-month');
  const nextBtn = $('#next-month');
  const timesTitle = $('#times-title');
  const timesDate = $('#times-date');
  const timesBody = $('#times-body');
  const confirmPanel = $('#confirm-panel');
  const confirmWhen = $('#confirm-when');
  const form = $('#confirm-form');
  const customFieldsHost = $('#custom-fields');
  const nameInput = $('#b-name');
  const emailInput = $('#b-email');
  const phoneInput = $('#b-phone');
  const backBtn = $('#back-to-times');
  const submitBtn = $('#confirm-submit');
  const successPanel = $('#booking-success');
  const successEmail = $('#success-email');
  const successWhen = $('#success-when');
  const successType = $('#success-type');
  const successTz = $('#success-tz');
  const successRef = $('#success-ref');
  const tzLabel = $('#cal-tz');

  // ---------- panel transition ----------
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ENTER_MS = prefersReducedMotion ? 0 : 460;
  const LEAVE_MS = prefersReducedMotion ? 0 : 240;
  let _transitioning = false;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function showPanel(targetEl) {
    if (_transitioning) return;
    if (!stage || !targetEl) return;
    const current = stage.querySelector(':scope > .stage-panel.is-active');
    if (current === targetEl) return;

    _transitioning = true;

    // measure before any changes
    const startH = stage.offsetHeight;
    if (startH) stage.style.minHeight = startH + 'px';

    // exit current
    if (current) {
      current.classList.remove('is-active', 'is-revealed');
      current.classList.add('is-leaving');
      await wait(LEAVE_MS);
      current.classList.remove('is-leaving');
      current.hidden = true;
    }

    // bring in target
    targetEl.hidden = false;
    targetEl.classList.add('is-entering');
    // force reflow so the panel's natural height is measurable
    void targetEl.offsetHeight;
    const endH = targetEl.offsetHeight;

    if (endH && startH && Math.abs(endH - startH) > 4) {
      stage.style.transition = 'min-height 460ms cubic-bezier(.22,.8,.22,1)';
      stage.style.minHeight = endH + 'px';
    }

    await wait(ENTER_MS);

    targetEl.classList.remove('is-entering');
    targetEl.classList.add('is-active');

    // inner stagger for panels that opt in
    requestAnimationFrame(() => targetEl.classList.add('is-revealed'));

    // release the height lock after the height transition settles
    setTimeout(() => {
      stage.style.transition = '';
      stage.style.minHeight = '';
    }, 480);

    _transitioning = false;
  }

  function scrollStageIntoViewIfNeeded() {
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.top < 0 || rect.top > innerHeight * 0.55) {
      stage.scrollIntoView({ block: 'start', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    }
  }

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch { /* leave null */ }
    if (!res.ok || (body && body.ok === false)) {
      const msg = body?.error?.message || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return body;
  }

  function fetchEventType() {
    return api('/api/event-type').then((r) => r.eventType);
  }

  function fetchMonthSlots(year, month) {
    // Cal slots are tz-grouped — pass our local tz so the grouping matches what
    // we'll display. start/end strings are date-only; the function appends time.
    const start = ymd(new Date(year, month, 1));
    const end = ymd(new Date(year, month + 1, 0));
    return api(`/api/slots?start=${start}&end=${end}&timeZone=${encodeURIComponent(tz)}`)
      .then((r) => r.slots || {});
  }

  // ---------- date utils ----------
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function monthLabelText(y, m) {
    return new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  function dateFullLabel(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }
  function timeLabel(iso) {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
    });
  }
  function tzShortLabel() {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, timeZoneName: 'short',
      }).formatToParts(new Date());
      const tzPart = parts.find((p) => p.type === 'timeZoneName');
      return tzPart ? tzPart.value : tz;
    } catch {
      return tz;
    }
  }

  // ---------- render: calendar ----------
  function renderCalendar() {
    monthLabel.textContent = monthLabelText(viewYear, viewMonth);
    grid.innerHTML = '';

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const firstWeekday = firstOfMonth.getDay();   // 0=Sun
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    // leading blanks
    for (let i = 0; i < firstWeekday; i++) {
      const blank = document.createElement('button');
      blank.type = 'button';
      blank.className = 'day empty';
      blank.disabled = true;
      blank.setAttribute('aria-hidden', 'true');
      grid.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewYear, viewMonth, d);
      const key = ymd(date);
      const slots = monthSlots[key] || [];
      const isPast = date < today;
      const isToday = date.getTime() === today.getTime();
      const hasSlots = slots.length > 0;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'day';
      cell.textContent = String(d);
      cell.setAttribute('data-date', key);
      cell.setAttribute('role', 'gridcell');
      if (isToday) cell.classList.add('today');
      if (isPast) cell.classList.add('past');
      if (hasSlots) cell.classList.add('has-slots');
      else cell.classList.add('no-slots');

      if (isPast || !hasSlots) {
        cell.disabled = true;
        cell.setAttribute('aria-label', `${dateFullLabel(key)} — no availability`);
      } else {
        cell.setAttribute('aria-label', `${dateFullLabel(key)} — ${slots.length} time${slots.length === 1 ? '' : 's'} available`);
        if (key === selectedDateKey) cell.classList.add('selected');
        cell.addEventListener('click', () => onDateClick(key));
      }
      grid.appendChild(cell);
    }

    // disable prev when viewing current month
    const showingCurrent = viewYear === today.getFullYear() && viewMonth === today.getMonth();
    prevBtn.disabled = showingCurrent;
  }

  // ---------- render: times ----------
  function renderTimes() {
    if (!selectedDateKey) {
      timesTitle.textContent = 'Available times';
      timesDate.textContent = 'Select a date to see open times.';
      timesBody.innerHTML = '<div class="times-empty">No date selected yet.</div>';
      return;
    }
    timesTitle.textContent = dateFullLabel(selectedDateKey).split(',').slice(0, 1).join(','); // "Monday"
    const fullParts = dateFullLabel(selectedDateKey).split(',');
    timesDate.textContent = fullParts.slice(1).join(',').trim() + ` · ${tzShortLabel()}`;

    const slots = monthSlots[selectedDateKey] || [];
    if (slots.length === 0) {
      timesBody.innerHTML = '<div class="times-empty">No open times on this day.</div>';
      return;
    }

    timesBody.innerHTML = '';
    const group = document.createElement('div');
    group.className = 'time-group';
    const list = document.createElement('div');
    list.className = 'time-slots';
    for (const slot of slots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot';
      btn.textContent = timeLabel(slot.start);
      btn.addEventListener('click', () => onTimeClick(slot));
      list.appendChild(btn);
    }
    group.appendChild(list);
    timesBody.appendChild(group);
  }

  // ---------- render: custom intake fields ----------
  function renderCustomFields() {
    if (!eventType || !customFieldsHost) return;
    customFieldsHost.innerHTML = '';
    for (const f of eventType.customFields || []) {
      const wrap = document.createElement('div');
      wrap.className = 'field field-full';
      const labelEl = document.createElement('label');
      labelEl.textContent = f.label + (f.required ? '' : ' ');
      if (!f.required) {
        const muted = document.createElement('span');
        muted.className = 'muted';
        muted.textContent = ' (optional)';
        labelEl.appendChild(muted);
      }

      if (f.type === 'radio' && Array.isArray(f.options)) {
        const fid = `cf-${f.slug}`;
        labelEl.setAttribute('id', `${fid}-lbl`);
        wrap.appendChild(labelEl);
        const group = document.createElement('div');
        group.className = 'radio-row';
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-labelledby', `${fid}-lbl`);
        if (f.required) group.dataset.required = 'true';
        group.dataset.slug = f.slug;
        for (const opt of f.options) {
          const optLabel = typeof opt === 'string' ? opt : (opt.label || opt.value || '');
          const optValue = typeof opt === 'string' ? opt : (opt.value || opt.label || '');
          const id = `${fid}-${optValue.toLowerCase().replace(/\s+/g, '-')}`;
          const radioWrap = document.createElement('label');
          radioWrap.className = 'radio-pill';
          radioWrap.setAttribute('for', id);
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = f.slug;
          input.id = id;
          input.value = optValue;
          if (f.required) input.required = true;
          radioWrap.appendChild(input);
          const span = document.createElement('span');
          span.textContent = optLabel;
          radioWrap.appendChild(span);
          group.appendChild(radioWrap);
        }
        wrap.appendChild(group);
      } else if (f.type === 'text' || f.type === 'textarea') {
        const id = `cf-${f.slug}`;
        labelEl.setAttribute('for', id);
        wrap.appendChild(labelEl);
        const el = document.createElement(f.type === 'textarea' ? 'textarea' : 'input');
        if (el.tagName === 'INPUT') el.type = 'text';
        el.id = id;
        el.name = f.slug;
        if (f.placeholder) el.placeholder = f.placeholder;
        if (f.required) el.required = true;
        el.maxLength = f.type === 'textarea' ? 500 : 120;
        wrap.appendChild(el);
      } else {
        // fallback: text input
        const id = `cf-${f.slug}`;
        labelEl.setAttribute('for', id);
        wrap.appendChild(labelEl);
        const input = document.createElement('input');
        input.type = 'text';
        input.id = id;
        input.name = f.slug;
        if (f.required) input.required = true;
        wrap.appendChild(input);
      }

      const err = document.createElement('small');
      err.className = 'error';
      err.dataset.for = f.slug;
      wrap.appendChild(err);
      customFieldsHost.appendChild(wrap);
    }
  }

  // ---------- handlers ----------
  function onDateClick(key) {
    selectedDateKey = key;
    renderCalendar();
    renderTimes();
  }

  function onTimeClick(slot) {
    selectedSlot = slot;
    const label = `${dateFullLabel(selectedDateKey)} at ${timeLabel(slot.start)} (${tzShortLabel()})`;
    confirmWhen.textContent = label;
    scrollStageIntoViewIfNeeded();
    showPanel(confirmPanel);
  }

  async function onMonthNav(dir) {
    const newDate = new Date(viewYear, viewMonth + dir, 1);
    const cap = new Date(today.getFullYear(), today.getMonth(), 1);
    if (newDate < cap) return;
    viewYear = newDate.getFullYear();
    viewMonth = newDate.getMonth();
    selectedDateKey = null;
    renderTimes();

    // direction-aware slide for the calendar grid
    grid.classList.remove('is-flying-in', 'is-flying-out', 'is-flying-out-right', 'is-flying-out-left');
    grid.classList.add(dir > 0 ? 'is-flying-out-left' : 'is-flying-out-right');
    if (!prefersReducedMotion) await wait(180);

    grid.innerHTML = '<div class="cal-loading">Loading availability…</div>';
    grid.classList.remove('is-flying-out-left', 'is-flying-out-right');
    grid.classList.add(dir > 0 ? 'is-flying-in-right' : 'is-flying-in-left');

    try {
      monthSlots = await fetchMonthSlots(viewYear, viewMonth);
      renderCalendar();
      // ensure entering class still applied after innerHTML replacement
      grid.classList.add(dir > 0 ? 'is-flying-in-right' : 'is-flying-in-left');
      requestAnimationFrame(() => {
        grid.classList.remove('is-flying-in-right', 'is-flying-in-left');
      });
    } catch (e) { showError(e); }
  }

  function onBackToTimes() {
    scrollStageIntoViewIfNeeded();
    showPanel(panelPick);
  }

  function setFieldError(slug, msg) {
    const el = form.querySelector(`.error[data-for="${slug}"]`);
    if (el) el.textContent = msg || '';
    // mark the parent field as having an error so we can style it
    const field = el?.closest('.field') ||
                  form.querySelector(`[name="${slug}"]`)?.closest('.field') ||
                  form.querySelector(`#cf-${slug}`)?.closest('.field') ||
                  form.querySelector(`[data-slug="${slug}"]`)?.closest('.field');
    if (field) field.classList.toggle('has-error', !!msg);
  }

  // clear field error + form banner the moment the user starts fixing the field
  // (event-delegated so it also catches dynamically rendered intake fields)
  if (form) {
    const clearOn = (e) => {
      const el = e.target;
      if (!el || !el.matches('input, select, textarea')) return;
      const name = el.name || (el.id || '').replace(/^(b-|cf-)/, '');
      if (name) setFieldError(name, '');
      clearFormBanner();
    };
    form.addEventListener('input', clearOn);
    form.addEventListener('change', clearOn);
  }

  function validate() {
    let ok = true;
    setFieldError('name', '');
    setFieldError('email', '');
    setFieldError('phone', '');

    const name = nameInput.value.trim();
    if (!name) { setFieldError('name', 'Please enter your name.'); ok = false; }

    const email = emailInput.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError('email', 'Please enter a valid email.');
      ok = false;
    }

    const ph = phoneInput.value.replace(/\D/g, '');
    if (ph && ph.length !== 10) {
      setFieldError('phone', 'Please enter a 10-digit phone number.');
      ok = false;
    }

    // custom fields
    for (const f of eventType?.customFields || []) {
      setFieldError(f.slug, '');
      if (!f.required) continue;
      if (f.type === 'radio') {
        const checked = form.querySelector(`input[name="${f.slug}"]:checked`);
        if (!checked) { setFieldError(f.slug, 'Please choose one.'); ok = false; }
      } else {
        const el = form.querySelector(`[name="${f.slug}"]`);
        if (!el || !el.value.trim()) {
          setFieldError(f.slug, 'Required.');
          ok = false;
        }
      }
    }
    return ok;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (form.querySelector('[name="website"]').value) return; // honeypot

    if (!validate()) {
      const firstErr = form.querySelector('.error:not(:empty)');
      if (firstErr) {
        const field = firstErr.closest('.field')?.querySelector('input, textarea, select');
        if (field) field.focus();
      }
      return;
    }

    const phone = phoneInput.value.replace(/\D/g, '');
    const responses = {};
    for (const f of eventType.customFields || []) {
      if (f.type === 'radio') {
        const checked = form.querySelector(`input[name="${f.slug}"]:checked`);
        if (checked) responses[f.slug] = checked.value;
      } else {
        const el = form.querySelector(`[name="${f.slug}"]`);
        if (el && el.value.trim()) responses[f.slug] = el.value.trim();
      }
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');
    clearFormBanner();

    try {
      const result = await api('/api/book', {
        method: 'POST',
        body: JSON.stringify({
          start: selectedSlot.start,
          name: nameInput.value.trim(),
          email: emailInput.value.trim().toLowerCase(),
          phone: phone ? `+1${phone}` : '',
          timeZone: tz,
          responses,
        }),
      });
      showSuccess(result.booking);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');
      handleSubmitError(err);
    }
  }

  /* -------- error surfacing (replaces alert popups) -------- */

  // Map of Cal API field names -> our local field slug + friendly message + element
  const CAL_FIELD_MAP = {
    attendeePhoneNumber: { slug: 'phone', friendly: 'Please enter a valid phone number we can reach you at.' },
    phone:               { slug: 'phone', friendly: 'Please enter a valid phone number.' },
    email:               { slug: 'email', friendly: 'Please enter a valid email.' },
    name:                { slug: 'name',  friendly: 'Please enter your name.' },
    // custom intake field slugs come back as-is
  };

  function clearFormBanner() {
    const b = $('#form-banner');
    if (b) { b.hidden = true; b.textContent = ''; }
  }

  function showFormBanner(msg) {
    let b = $('#form-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'form-banner';
      b.className = 'form-banner';
      b.setAttribute('role', 'alert');
      // place at the top of the confirm form
      form.insertBefore(b, form.firstChild);
    }
    b.textContent = msg;
    b.hidden = false;
  }

  /** Parse an API error and route it to the appropriate field, or to the form banner. */
  function handleSubmitError(err) {
    const raw = (err && err.message) ? String(err.message) : 'Booking failed. Please try another time.';

    // Cal's responses errors come back like "responses - {attendeePhoneNumber}invalid_number,"
    // — extract the bracketed field name.
    const fieldMatch = raw.match(/\{([\w-]+)\}/);
    if (fieldMatch) {
      const calField = fieldMatch[1];
      const reasonRaw = raw.split('}').pop().replace(/[,;\s]+$/, '').trim();
      const mapped = CAL_FIELD_MAP[calField] || { slug: calField, friendly: null };
      const friendly = mapped.friendly || prettyReason(reasonRaw) || raw;
      const slug = mapped.slug;

      setFieldError(slug, friendly);

      // focus the field
      const target = form.querySelector(
        `#b-${slug}, input[name="${slug}"], select[name="${slug}"], textarea[name="${slug}"]`,
      );
      if (target) {
        try { target.focus({ preventScroll: false }); } catch { target.focus(); }
        target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' });
      }
      return;
    }

    // Slot-was-taken style errors
    if (/no_available_users|already booked|no availability|slot/i.test(raw)) {
      showFormBanner('That time was just taken. Please pick another slot.');
      // optional: auto-bounce back to picker after a beat
      setTimeout(() => { showPanel(panelPick); }, 1600);
      return;
    }

    // Fall back to a banner at the top of the form so it's not a popup
    showFormBanner(raw);
  }

  /** Turn cryptic Cal reasons into plain English. */
  function prettyReason(reason) {
    if (!reason) return null;
    const r = reason.toLowerCase();
    if (r.includes('invalid_number')) return 'Please enter a valid phone number.';
    if (r.includes('invalid_format')) return 'That value doesn\'t look right — please double-check the format.';
    if (r.includes('required')) return 'This field is required.';
    return null;
  }

  async function showSuccess(booking) {
    // populate success copy
    successEmail.textContent = emailInput.value.trim().toLowerCase();
    successWhen.textContent = `${dateFullLabel(selectedDateKey)} · ${timeLabel(booking.start || selectedSlot.start)}`;
    if (successTz) successTz.textContent = tzShortLabel();
    if (successType) successType.textContent = `${eventType.title} · ${eventType.lengthInMinutes} min · Telehealth`;
    if (successRef) successRef.textContent = booking.uid || '—';

    scrollStageIntoViewIfNeeded();
    await showPanel(successPanel);

    // reset submit button state so if the user comes back via "book another", it's clean
    submitBtn.disabled = false;
    submitBtn.classList.remove('is-loading');
  }

  function showError(err) {
    if (!errorBox) return;
    errorBox.hidden = false;
    errorBox.textContent = err?.message || 'Something went wrong loading availability.';
  }

  // ---------- phone formatting ----------
  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      const d = phoneInput.value.replace(/\D/g, '').slice(0, 10);
      if (d.length === 0) { phoneInput.value = ''; return; }
      if (d.length < 4) phoneInput.value = d;
      else if (d.length < 7) phoneInput.value = `(${d.slice(0, 3)}) ${d.slice(3)}`;
      else phoneInput.value = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    });
  }

  // ---------- wire up + boot ----------
  prevBtn.addEventListener('click', () => onMonthNav(-1));
  nextBtn.addEventListener('click', () => onMonthNav(1));
  backBtn.addEventListener('click', onBackToTimes);
  form.addEventListener('submit', onSubmit);
  if (tzLabel) tzLabel.textContent = tzShortLabel();

  async function boot() {
    try {
      eventType = await fetchEventType();
      const t = $('#booking-event-title');
      if (t) t.textContent = `${eventType.title} · ${eventType.lengthInMinutes} min`;
      renderCustomFields();
      monthSlots = await fetchMonthSlots(viewYear, viewMonth);
      renderCalendar();
      renderTimes();
      stage.hidden = false;
      // bring the calendar panel in via the same transition pipeline as later swaps
      await showPanel(panelPick);
    } catch (err) {
      showError(err);
    }
  }

  boot();
})();
