(() => {
  // year stamp
  const yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  // ----- state -----
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-indexed
  let selectedDate = null; // Date object
  let selectedTime = null; // "HH:MM"

  // synthetic schedule: weekdays only, varying availability.
  // For each future weekday in view, pick a deterministic subset of slots.
  // Closed: Sat (6), Sun (0). Also closed: random "full" days for realism.
  const ALL_SLOTS = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
  ];

  // deterministic pseudo-random based on date — same date always returns same slots.
  const slotsForDate = (d) => {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return []; // closed weekends
    const fri = dow === 5;
    // seed from yyyymmdd
    const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const rand = (n) => ((seed * 9301 + n * 49297) % 233280) / 233280;
    if (rand(0) < 0.18) return []; // ~18% of days are "full"
    return ALL_SLOTS.filter((_, i) => {
      // Fridays end at 1pm
      const hour = parseInt(ALL_SLOTS[i].slice(0, 2), 10);
      if (fri && hour >= 13) return false;
      return rand(i + 1) > 0.45;
    });
  };

  const fmtMonth = (y, m) =>
    new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const fmtFullDate = (d) =>
    d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const fmtTime = (t) => {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  // ----- calendar render -----
  const monthLabel = document.getElementById('cal-month');
  const grid = document.getElementById('cal-grid');
  const prevBtn = document.getElementById('prev-month');
  const nextBtn = document.getElementById('next-month');

  const renderCalendar = () => {
    monthLabel.textContent = fmtMonth(viewYear, viewMonth);
    grid.innerHTML = '';

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    // leading blanks
    for (let i = 0; i < firstDay; i++) {
      const blank = document.createElement('div');
      blank.className = 'day empty';
      grid.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewYear, viewMonth, d);
      date.setHours(0, 0, 0, 0);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day';
      btn.textContent = d;

      const isPast = date < today;
      const slots = slotsForDate(date);
      const hasSlots = slots.length > 0;
      const isToday = date.getTime() === today.getTime();

      if (isToday) btn.classList.add('today');

      if (isPast) {
        btn.classList.add('past');
        btn.disabled = true;
      } else if (!hasSlots) {
        btn.classList.add('no-slots');
        btn.disabled = true;
        btn.setAttribute('aria-label', `${date.toDateString()} — no availability`);
      } else {
        btn.classList.add('has-slots');
        btn.setAttribute('aria-label', `${date.toDateString()} — ${slots.length} times available`);
        btn.addEventListener('click', () => selectDate(date));
      }

      if (selectedDate && date.getTime() === selectedDate.getTime()) {
        btn.classList.add('selected');
      }

      grid.appendChild(btn);
    }

    // disable prev if we're at this month
    const atMin = viewYear === today.getFullYear() && viewMonth === today.getMonth();
    prevBtn.disabled = atMin;
  };

  // ----- time slots render -----
  const timesTitle = document.getElementById('times-title');
  const timesDate = document.getElementById('times-date');
  const timesBody = document.getElementById('times-body');

  const renderTimes = () => {
    if (!selectedDate) {
      timesDate.textContent = 'Select a date to see open times.';
      timesBody.innerHTML = '<div class="times-empty">No date selected yet.</div>';
      return;
    }
    timesDate.textContent = fmtFullDate(selectedDate);
    const slots = slotsForDate(selectedDate);
    if (slots.length === 0) {
      timesBody.innerHTML = '<div class="times-empty">No openings on this day.</div>';
      return;
    }

    const morning = slots.filter(s => parseInt(s, 10) < 12);
    const afternoon = slots.filter(s => parseInt(s, 10) >= 12);

    const group = (label, list) => {
      if (!list.length) return '';
      return `
        <div class="time-group">
          <p>${label}</p>
          <div class="time-slots">
            ${list.map(t => `<button type="button" class="slot${selectedTime === t ? ' selected' : ''}" data-time="${t}">${fmtTime(t)}</button>`).join('')}
          </div>
        </div>
      `;
    };

    timesBody.innerHTML = group('Morning', morning) + group('Afternoon', afternoon);

    timesBody.querySelectorAll('.slot').forEach(btn => {
      btn.addEventListener('click', () => selectTime(btn.dataset.time));
    });
  };

  // ----- step indicators -----
  const setStep = (n) => {
    [1, 2, 3].forEach(i => {
      const el = document.getElementById('step-' + i);
      el.classList.remove('active', 'done');
      if (i < n) el.classList.add('done');
      if (i === n) el.classList.add('active');
    });
  };

  // ----- selection handlers -----
  const selectDate = (d) => {
    selectedDate = d;
    selectedTime = null;
    renderCalendar();
    renderTimes();
    setStep(2);
    // close the confirm panel if it was open
    document.getElementById('confirm-panel').hidden = true;
    // scroll times panel into view on mobile
    if (window.innerWidth < 860) {
      document.querySelector('.times-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const selectTime = (t) => {
    selectedTime = t;
    renderTimes();
    openConfirm();
    setStep(3);
  };

  // ----- confirm panel -----
  const confirmPanel = document.getElementById('confirm-panel');
  const confirmWhen = document.getElementById('confirm-when');
  const confirmForm = document.getElementById('confirm-form');
  const backBtn = document.getElementById('back-to-times');

  const openConfirm = () => {
    confirmWhen.textContent = `${fmtFullDate(selectedDate)} · ${fmtTime(selectedTime)}`;
    confirmPanel.hidden = false;
    confirmPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  backBtn.addEventListener('click', () => {
    confirmPanel.hidden = true;
    selectedTime = null;
    renderTimes();
    setStep(2);
    document.querySelector('.times-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // phone formatting
  const bPhone = document.getElementById('b-phone');
  bPhone.addEventListener('input', () => {
    const d = bPhone.value.replace(/\D/g, '').slice(0, 10);
    if (d.length === 0) { bPhone.value = ''; return; }
    if (d.length < 4) bPhone.value = d;
    else if (d.length < 7) bPhone.value = `(${d.slice(0,3)}) ${d.slice(3)}`;
    else bPhone.value = `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  });

  const setErr = (name, text) => {
    const el = confirmForm.querySelector(`[data-for="${name}"]`);
    if (el) el.textContent = text || '';
  };

  const validateConfirm = () => {
    let ok = true;
    const data = new FormData(confirmForm);

    if (!(data.get('name') || '').toString().trim()) { setErr('name', 'Please enter your name.'); ok = false; } else setErr('name', '');
    if (!(data.get('dob') || '')) { setErr('dob', 'Please enter your date of birth.'); ok = false; } else setErr('dob', '');

    const email = (data.get('email') || '').toString().trim();
    if (!email) { setErr('email', 'Please enter your email.'); ok = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('email', 'Please enter a valid email.'); ok = false; }
    else setErr('email', '');

    const phone = (data.get('phone') || '').toString().replace(/\D/g, '');
    if (phone.length !== 10) { setErr('phone', 'Please enter a 10-digit phone number.'); ok = false; } else setErr('phone', '');

    return ok;
  };

  confirmForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (confirmForm.querySelector('[name="website"]').value) return;
    if (!validateConfirm()) {
      const first = confirmForm.querySelector('.error:not(:empty)');
      if (first) {
        const f = first.closest('.field').querySelector('input, select, textarea');
        if (f) f.focus();
      }
      return;
    }

    // build a fake reference id: APT-YYYYMMDD-NNN
    const d = selectedDate;
    const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const n = String(Math.floor(Math.random() * 900) + 100);
    const ref = `APT-${stamp}-${n}`;

    document.getElementById('booking-app').hidden = true;
    document.querySelector('.steps').hidden = true;
    const success = document.getElementById('booking-success');
    document.getElementById('success-email').textContent = confirmForm.email.value;
    document.getElementById('success-when').textContent = `${fmtFullDate(selectedDate)} at ${fmtTime(selectedTime)}`;
    document.getElementById('success-type').textContent = confirmForm.type.value;
    document.getElementById('success-format').textContent = confirmForm.format.value;
    document.getElementById('success-ref').textContent = `Reference: ${ref}`;
    success.hidden = false;
    success.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ----- month nav -----
  prevBtn.addEventListener('click', () => {
    if (prevBtn.disabled) return;
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  });
  nextBtn.addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  });

  // initial
  renderCalendar();
  renderTimes();
})();
