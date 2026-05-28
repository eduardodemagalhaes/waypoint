// ── TIMELINE ─────────────────────────────────────────────────
const TYPE_ICON = {flight:'✈',hotel:'🏨',train:'🚂',taxi:'🚕',car:'🚗',activity:'🎯',other:'📌'};
const BADGE     = {ok:'badge-pending',needs_review:'badge-review',failed:'badge-review',pending:'badge-pending'};
const BADGE_LBL = {ok:'Unconfirmed',needs_review:'Needs review',failed:'Failed',pending:'Pending'};

function renderTimeline() {
  const tl   = document.getElementById('timeline');
  const segs = (currentTrip.segments || []).slice()
    .sort((a,b) => (a.departs_at||'').localeCompare(b.departs_at||''));
  if (!segs.length) {
    tl.innerHTML = `<div class="empty">
      <div class="empty-title">No segments yet</div>
      <div class="empty-sub">Type in the bar above, or use + Add segment.</div>
    </div>`; return;
  }
  const days = {};
  segs.forEach(s => {
    const day = (s.departs_at||'').slice(0,10) || 'unknown';
    if (!days[day]) days[day] = [];
    days[day].push(s);
  });
  let html = '';
  Object.entries(days).forEach(([day, daySegs]) => {
    html += `<div class="day-label"><span class="day-date">${fmtDay(day)}</span><div class="day-line"></div></div>`;
    daySegs.forEach(s => {
      const isHotel    = s.type === 'hotel';
      const isFlight   = s.type === 'flight' || s.type === 'train';
      const depTime    = depT(s.departs_at);
      const arrTime    = arrT(s.departs_at, s.arrives_at);
      const overnight  = overnightDays(s.departs_at, s.arrives_at);
      const duration   = flightDuration(s.departs_at, s.arrives_at, s.departs_tz, s.arrives_tz);
      const bClass     = s.confirmed ? 'badge-ok' : BADGE[s.parse_status] || 'badge-pending';
      const bLbl       = s.confirmed ? 'Confirmed' : BADGE_LBL[s.parse_status] || 'Pending';
      const nights     = isHotel && s.meta && s.meta.nights ? ` · ${s.meta.nights} nights` : '';

      // Route label
      const orig  = s.origin      || '—';
      const dest  = s.destination || null;
      const routeHtml = dest
        ? `${orig}<span class="arr"> → </span>${dest}`
        : orig;

      // Time strip for flights/trains
      let timeStrip = '';
      if (isFlight && depTime && arrTime) {
        timeStrip = `<div class="time-strip">
          <span class="ts-dep">${depTime}</span>
          <span class="ts-line">${duration ? `<span class="ts-dur">${duration}</span>` : ''}</span>
          <span class="ts-arr">${arrTime}${overnight ? `<sup class="ts-overnight">+${overnight}</sup>` : ''}</span>
        </div>`;
      }

      // Sub-line: carrier · ref
      const subParts = [s.carrier].filter(Boolean);
      const sub = subParts.join(' · ');

      // Hotel-specific card content
      const m = s.meta || {};
      let hotelStrip = '';
      if (isHotel) {
        const ciDate  = (s.departs_at||'').slice(0,10);
        const coDate  = (s.arrives_at||'').slice(0,10);
        const ciTime  = depTime  ? ` at ${depTime}`  : (m.checkin_time  ? ` at ${m.checkin_time}`  : '');
        const coTime  = (s.arrives_at||'').slice(11,16).replace('00:00','') 
                          ? ` at ${(s.arrives_at||'').slice(11,16)}` 
                          : (m.checkout_time ? ` at ${m.checkout_time}` : '');
        const ciStr   = ciDate ? `${fmtShort(ciDate)}${ciTime}` : '—';
        const coStr   = coDate ? `${fmtShort(coDate)}${coTime}` : '—';
        const starsHtml = m.stars ? ' ' + '★'.repeat(Math.min(parseInt(m.stars)||0,5)) : '';
        const phoneHtml = m.phone ? `<div class="hotel-phone">📞 ${m.phone}</div>` : '';
        const addrHtml  = m.address ? `<div class="hotel-addr">📍 ${m.address}</div>` : '';
        hotelStrip = `
          <div class="hotel-dates">
            <span class="hotel-ci"><span class="hotel-dt-lbl">Check-in</span> ${ciStr}</span>
            <span class="hotel-arrow">→</span>
            <span class="hotel-co"><span class="hotel-dt-lbl">Check-out</span> ${coStr}</span>
          </div>
          ${phoneHtml}${addrHtml}`;
      }

      html += `<div class="seg" data-id="${s.id}">
        <div class="seg-tc"><span class="seg-time">${isHotel ? '' : (depTime||'—')}</span><div class="seg-line"></div></div>
        <div class="seg-card ${s.type}" onclick="toggleDetail(this)">
          <div class="seg-top">
            <span class="seg-icon">${TYPE_ICON[s.type]||'📌'}</span>
            <div class="seg-main">
              <div class="seg-route">${isHotel ? (s.carrier||orig) : routeHtml}${!isHotel ? nights : ''}</div>
              ${isHotel ? hotelStrip : (timeStrip || '')}
              ${!isHotel && sub ? `<div class="seg-sub">${sub}</div>` : ''}
              ${isHotel && m.stars ? `<div class="seg-sub">${'★'.repeat(Math.min(parseInt(m.stars)||0,5))} ${m.nights ? m.nights+' nights' : ''}</div>` : ''}
            </div>
            <div class="seg-right">
              ${s.confirmation_ref ? `<div class="conf-ref">${s.confirmation_ref}</div>` : ''}
              <span class="badge ${bClass}">${bLbl}</span>
            </div>
          </div>
          <div class="seg-detail">
            ${detailFields(s)}
            <div style="grid-column:1/-1" class="seg-actions">
              <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEditSeg('${s.id}')">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openSegDetails('${s.id}')">Details</button>
              <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteSeg('${s.id}')">Delete</button>
            </div>
          </div>
        </div>
      </div>`;
      if (isHotel && s.meta && s.meta.nights && s.meta.nights > 1) {
        html += `<div class="bridge">
          <div class="bridge-line"><div class="bridge-bar"></div></div>
          <div class="bridge-lbl">${s.meta.nights} nights · ${s.carrier||s.origin||''}</div>
        </div>`;
      }
    });
  });
  tl.innerHTML = html;
}

function df(lbl, val) {
  if (!val && val !== 0) return '';
  return `<div><div class="det-lbl">${lbl}</div><div class="det-val">${val}</div></div>`;
}

function detailFields(s) {
  const m = s.meta || {};
  const type = s.type;
  let out = '';

  // ── FLIGHT ────────────────────────────────────────────
  if (type === 'flight') {
    if (m.enrich_status === 'needs_flight_number') {
      out += `<div style="grid-column:1/-1;padding:6px 10px;background:#fef3e8;border-radius:6px;font-size:12px;color:#9a6000;border:1px solid #f5d5b0">
        ✏️ ${m.enrich_reason || 'Add a flight number to enable enrichment'}
      </div>`;
    }
    if (m.delay_minutes > 0) out += df('Expected', `+${m.delay_minutes}m delay`);
    const _dur = flightDuration(s.departs_at, s.arrives_at, s.departs_tz, s.arrives_tz);
    if (_dur) out += df('Duration', _dur);
    // Gate/terminal only shown when operationally confirmed (not hints)
    if (m.terminal_departure && !m.terminal_hint) out += df('Terminal', m.terminal_departure);
    if (m.gate && !m.terminal_hint) out += df('Gate', m.gate);
    out += df('Boarding', m.boarding_time);
    out += df('Seat', m.seat);
    out += df('Cabin', m.cabin_class);
    out += df('Baggage', m.baggage_allowance);
    out += df('Baggage claim', m.baggage_claim || null);
  }

  // ── TRAIN ─────────────────────────────────────────────
  if (type === 'train') {
    out += df('Service', m.train_number);
    out += df('Class', m.class);
    out += df('Coach', m.coach);
    out += df('Seat', m.seat);
    out += df('Platform dep', m.platform_departure ? `Platform ${m.platform_departure}` : null);
    out += df('Platform arr', m.platform_arrival ? `Platform ${m.platform_arrival}` : null);
    out += df('Price', m.price);
    if (s.departs_tz && s.arrives_tz && s.departs_tz !== s.arrives_tz)
      out += df('Timezones', `${s.departs_tz} → ${s.arrives_tz}`);
  }

  // ── HOTEL ─────────────────────────────────────────────
  if (type === 'hotel') {
    out += df('Address', m.address);
    out += df('Room', m.room_type);
    out += df('Check-in', m.checkin_time);
    out += df('Check-out', m.checkout_time);
    out += df('Nights', m.nights);
    out += df('Rate', m.rate_plan);
    out += df('Points', m.loyalty_points);
    out += df('Phone', m.phone ? `<a href="tel:${m.phone}" style="color:inherit">${m.phone}</a>` : null);
    out += df('Website', m.website ? `<a href="${m.website}" target="_blank" style="color:var(--blue)">${m.website.replace(/^https?:\/\//,'').slice(0,40)}</a>` : null);
    out += df('Stars', m.stars ? '★'.repeat(Math.min(parseInt(m.stars)||0,5)) : null);
    out += df('Cancellation', m.cancellation_policy);
    out += df('Price', m.price);
    out += df('Card', m.payment_card);

  }

  // ── TAXI ──────────────────────────────────────────────
  if (type === 'taxi') {
    out += df('Driver', m.driver);
    out += df('Phone', m.phone);
    out += df('Dep timezone', s.departs_tz);
    out += df('Price', m.price);
    out += df('Confirmation', s.confirmation_ref);
  }

  // ── UNIVERSAL ─────────────────────────────────────────
  if (m.notes) out += df('Notes', m.notes);
  if (s.parse_status === 'needs_review' || s.parse_status === 'failed') {
    out += `<div><div class="det-lbl">Status</div><div class="det-val warn">Needs manual review</div></div>`;
  }
  // aviationstack_note is a parse-time artifact — not shown in detail view
  return out;
}

function toggleDetail(card) {
  // Close all other open details first so two cards don't end up open simultaneously
  document.querySelectorAll('.seg-detail.open').forEach(d => {
    if (d.closest('.seg-card') !== card) d.classList.remove('open');
  });
  card.querySelector('.seg-detail').classList.toggle('open');
}

function renderEmpty() {
  openHomeView();
}

