(() => {
  // year stamp
  const yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  // sticky top bar — toggle elevated state once the user scrolls past ~8px
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    const sync = () => topbar.classList.toggle('is-scrolled', window.scrollY > 8);
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => { sync(); ticking = false; });
        ticking = true;
      }
    }, { passive: true });
    sync();
  }

  // scroll-reveal
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealers = document.querySelectorAll('.reveal, .reveal-grid');
  if (reduce || !('IntersectionObserver' in window)) {
    revealers.forEach(el => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    revealers.forEach(el => io.observe(el));
  }

  // mobile menu (dropdown with open/close transitions)
  const ham = document.getElementById('hamburger');
  const menu = document.getElementById('mobile-menu');
  if (ham && menu) {
    // remove the `hidden` attribute so CSS controls visibility via .is-open
    menu.hidden = false;
    menu.setAttribute('aria-hidden', 'true');

    const isOpen = () => menu.classList.contains('is-open');
    const close = () => {
      menu.classList.remove('is-open');
      ham.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
    };
    const open = () => {
      menu.classList.add('is-open');
      ham.setAttribute('aria-expanded', 'true');
      menu.setAttribute('aria-hidden', 'false');
    };
    ham.addEventListener('click', (e) => {
      e.stopPropagation();
      isOpen() ? close() : open();
    });
    menu.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') close();
      else e.stopPropagation();
    });
    document.addEventListener('click', () => {
      if (isOpen()) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 860 && isOpen()) close();
    });
  }

  // contact form
  const form = document.getElementById('contact-form');
  const success = document.getElementById('form-success');
  const sendAnother = document.getElementById('send-another');
  const msg = document.getElementById('cf-msg');
  const count = document.getElementById('cf-count');
  const phone = document.getElementById('cf-phone');

  if (msg && count) {
    const update = () => {
      count.textContent = msg.value.length;
    };
    msg.addEventListener('input', update);
    update();
  }

  if (phone) {
    phone.addEventListener('input', () => {
      const d = phone.value.replace(/\D/g, '').slice(0, 10);
      if (d.length === 0) { phone.value = ''; return; }
      if (d.length < 4) phone.value = d;
      else if (d.length < 7) phone.value = `(${d.slice(0,3)}) ${d.slice(3)}`;
      else phone.value = `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
    });
  }

  const setError = (name, text) => {
    const el = form.querySelector(`[data-for="${name}"]`);
    if (el) el.textContent = text || '';
  };

  const validate = () => {
    let ok = true;
    const data = new FormData(form);

    const name = (data.get('name') || '').toString().trim();
    if (!name) { setError('name', 'Please enter your name.'); ok = false; }
    else setError('name', '');

    const email = (data.get('email') || '').toString().trim();
    if (!email) { setError('email', 'Please enter your email.'); ok = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('email', 'Please enter a valid email.'); ok = false;
    } else setError('email', '');

    const ph = (data.get('phone') || '').toString().replace(/\D/g, '');
    if (ph && ph.length !== 10) {
      setError('phone', 'Please enter a 10-digit phone number.'); ok = false;
    } else setError('phone', '');

    return ok;
  };

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // honeypot
      if (form.querySelector('[name="website"]').value) return;
      if (!validate()) {
        const first = form.querySelector('.error:not(:empty)');
        if (first) {
          const field = first.closest('.field').querySelector('input, select, textarea');
          if (field) field.focus();
        }
        return;
      }
      // simulate submit (no backend in this example)
      form.hidden = true;
      success.hidden = false;
      success.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  if (sendAnother) {
    sendAnother.addEventListener('click', () => {
      success.hidden = true;
      form.hidden = false;
      form.reset();
      if (count) count.textContent = '0';
      form.querySelectorAll('.error').forEach(e => e.textContent = '');
    });
  }

  // ----- parallax (hero + My Approach spotlight) -----
  // Each pair has a section we read scroll position from, and a photo we
  // translate at a fraction of scroll speed for depth.
  const parallaxPairs = [
    { section: document.querySelector('.hero'),       photo: document.querySelector('.hero-photo'),      strength: 0.35 },
    { section: document.querySelector('.spotlight'),  photo: document.querySelector('.spotlight-photo'), strength: 0.25 },
  ].filter((p) => p.section && p.photo);

  if (parallaxPairs.length && !reduce) {
    const update = () => {
      const vh = window.innerHeight;
      const viewportCenter = vh / 2;
      for (const { section, photo, strength } of parallaxPairs) {
        const rect = section.getBoundingClientRect();
        // skip work when section is well offscreen
        if (rect.bottom < -200 || rect.top > vh + 200) continue;
        const sectionCenter = rect.top + rect.height / 2;
        const offset = (sectionCenter - viewportCenter) * strength;
        photo.style.transform = `translate3d(0, ${-offset}px, 0)`;
      }
    };
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => { update(); ticking = false; });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  // insurance "view more" toggle: dynamic visible count based on column count
  const insToggle = document.getElementById('ins-toggle');
  const insGrid = document.getElementById('ins-grid');
  if (insToggle && insGrid) {
    const total = insGrid.querySelectorAll('.ins-card').length;
    const label = insToggle.querySelector('.ins-toggle-label');

    const columnCount = () => {
      const cs = window.getComputedStyle(insGrid);
      return cs.gridTemplateColumns.split(' ').filter(Boolean).length || 1;
    };
    const visibleCount = () => columnCount() * 2;

    const sync = () => {
      const expanded = insGrid.classList.contains('is-expanded');
      const hidden = Math.max(0, total - visibleCount());
      if (hidden === 0) {
        insToggle.style.display = 'none';
        return;
      }
      insToggle.style.display = '';
      label.textContent = expanded ? 'Show fewer plans' : `View ${hidden} more plans`;
    };

    insToggle.addEventListener('click', () => {
      const expanded = insGrid.classList.toggle('is-expanded');
      insToggle.setAttribute('aria-expanded', String(expanded));
      sync();
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sync, 120);
    });

    sync();
  }
})();
