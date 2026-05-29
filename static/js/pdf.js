// ── PDF Upload ────────────────────────────────────────────────────────────────
function triggerPdfUpload() {
  if (!currentTrip) { toast('Select a trip first'); return; }
  document.getElementById('pdfFileInput').click();
}

async function handlePdfFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.pdf')) { toast('Please select a PDF file'); return; }
  if (!currentTrip) { toast('Select a trip first'); return; }

  const prog = document.getElementById('pdfProgress');
  if (prog) { prog.style.display = 'block'; prog.textContent = `Parsing ${file.name}…`; }

  try {
    const form = new FormData();
    form.append('file', file);

    const url = `${API}/api/emails/upload-pdf?trip_id=${encodeURIComponent(currentTrip.id)}`;
    const r = await fetch(url, { method: 'POST', credentials: 'include', body: form });
    const res = await r.json();

    if (!r.ok) throw new Error(res.detail || 'Upload failed');

    if (res.parse_status === 'no_segments') {
      toast('No travel details found in that PDF — try forwarding the email instead');
    } else if (res.parse_status === 'failed') {
      toast('Could not process PDF: ' + (res.error || 'unknown error'));
    } else if (res.segments_created > 0) {
      toast(`✓ Added ${res.segments_created} segment${res.segments_created > 1 ? 's' : ''} from PDF`);
      await loadTrips();
      const updated = trips.find(t => t.id === currentTrip.id);
      if (updated) selectTrip(updated);
    }
  } catch(e) {
    toast('PDF upload failed [ERR13]: ' + e.message);
    console.error('[ERR13]', e);
  } finally {
    if (prog) { prog.textContent = ''; prog.style.display = 'none'; }
    document.getElementById('pdfFileInput').value = '';
  }
}


// ── Calendar subscription ─────────────────────────────────────────────────────
async function openCalendarModal() {
  if (!currentTrip) return;
  document.getElementById('calendarOverlay').classList.add('open');
  document.getElementById('calTripUrl').textContent = 'Loading…';
  document.getElementById('calUserUrl').textContent = 'Loading…';

  try {
    const r = await fetch(`${API}/api/trips/${currentTrip.id}/calendar-token`, {credentials:'include'});
    if (!r.ok) throw new Error('Failed to load calendar URLs');
    const d = await r.json();

    document.getElementById('calTripUrl').textContent = d.trip_ics_url;
    document.getElementById('calUserUrl').textContent = d.user_ics_url;
    document.getElementById('calTripWebcal').href = d.trip_webcal;
    document.getElementById('calUserWebcal').href = d.user_webcal;
  } catch(e) {
    document.getElementById('calTripUrl').textContent = 'Error loading URL';
    document.getElementById('calUserUrl').textContent = 'Error loading URL';
  }
}

function closeCalendarModal() {
  document.getElementById('calendarOverlay').classList.remove('open');
}

function copyCalUrl(elId) {
  const url = document.getElementById(elId).textContent;
  navigator.clipboard.writeText(url).then(() => toast('URL copied to clipboard'));
}
