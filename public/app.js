/* ================================================================
   CI/CO Dashboard — App Logic
   localStorage-only time tracker, 1-week scope
   Matches Telegram bot business rules:
     - Weekly target: 44h (2640 min)
     - Daily target: 8h (480 min)
     - Lunch break: 1h deducted if session > 4h
     - Work days: Mon–Sat (T2–T7)
   ================================================================ */

(function () {
  'use strict';

  // ─── Constants ───
  const WEEKLY_TARGET = 44 * 60;
  const DAILY_TARGET = 8 * 60;
  const LUNCH_BREAK = 60;
  const LUNCH_THRESHOLD = 4 * 60;
  const STORAGE_KEY = 'cico_data';
  const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const DAY_FULL = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  var DEFAULT_IN = '08:00';
  var DEFAULT_OUT = '17:30';

  // ─── State ───
  let data = { weekStart: '', entries: {} };
  let selectedDate = null;
  let editingDate = null; // date string of card currently in inline-edit mode
  let clockTimer = null;

  // ─── DOM References ───
  const $ = (id) => document.getElementById(id);

  // ============================================================
  // UTILS
  // ============================================================

  function getISOWeekStart(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function fmtDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function fmtDateShort(date) {
    return String(date.getDate()).padStart(2, '0') + '/' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function fmtMinutes(total) {
    if (total === 0) return '0h00m';
    var abs = Math.abs(total);
    var h = Math.floor(abs / 60);
    var m = abs % 60;
    var s = h + 'h' + String(m).padStart(2, '0') + 'm';
    return total < 0 ? '-' + s : s;
  }

  function parseTime(str) {
    var parts = str.split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function calcDuration(checkIn, checkOut) {
    var inM = parseTime(checkIn);
    var outM = parseTime(checkOut);
    var duration = outM - inM;
    if (duration <= 0) return 0;
    if (duration > LUNCH_THRESHOLD) {
      duration = Math.max(0, duration - LUNCH_BREAK);
    }
    return duration;
  }

  function getISOWeekNumber(date) {
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  // ─── Time Parsers (ported from bot logic) ───

  function pad2(n) { return String(n).padStart(2, '0'); }

  function parseClockTime(text) {
    text = text.trim().toLowerCase();
    // "08:30" or "8:30" or "8h30"
    var m1 = text.match(/^([01]?\d|2[0-3])[:h]([0-5]?\d)$/);
    if (m1) return pad2(Number(m1[1])) + ':' + pad2(Number(m1[2]));
    // "8" or "8h" → 08:00
    var m2 = text.match(/^([01]?\d|2[0-3])h?$/);
    if (m2) return pad2(Number(m2[1])) + ':00';
    // "830" or "1730"
    var m3 = text.match(/^(\d{3,4})$/);
    if (m3) {
      var digits = m3[1];
      var hp = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
      var mp = digits.slice(-2);
      var h = Number(hp), mn = Number(mp);
      if (h >= 0 && h <= 23 && mn >= 0 && mn <= 59) return pad2(h) + ':' + pad2(mn);
    }
    return null;
  }

  function parseTimeRange(text) {
    var parts = text.trim().split(/[\s\-→]+/).filter(Boolean);
    if (parts.length < 2) return null;
    var s = parseClockTime(parts[0]);
    var e = parseClockTime(parts[1]);
    if (!s || !e) return null;
    return { checkIn: s, checkOut: e };
  }
  // ============================================================
  // STORAGE
  // ============================================================

  function loadData() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { initWeek(); return; }
    try {
      var parsed = JSON.parse(raw);
      var currentWeekStart = fmtDate(getISOWeekStart(new Date()));
      if (parsed.weekStart !== currentWeekStart) {
        initWeek();
        return;
      }
      data = parsed;
    } catch (e) {
      initWeek();
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function initWeek() {
    data = {
      weekStart: fmtDate(getISOWeekStart(new Date())),
      entries: {}
    };
    saveData();
  }

  // ============================================================
  // CALCULATIONS
  // ============================================================

  function getWeekDays() {
    var start = new Date(data.weekStart + 'T00:00:00');
    var days = [];
    var todayStr = fmtDate(new Date());
    for (var i = 0; i < 7; i++) {
      var d = new Date(start);
      d.setDate(d.getDate() + i);
      var dateStr = fmtDate(d);
      days.push({
        date: dateStr,
        dayOfWeek: d.getDay(),
        dayName: DAY_LABELS[d.getDay()],
        dayFull: DAY_FULL[d.getDay()],
        dateShort: fmtDateShort(d),
        isWorkDay: d.getDay() >= 1 && d.getDay() <= 6,
        isToday: dateStr === todayStr,
        entry: data.entries[dateStr] || null
      });
    }
    return days;
  }

  function getDayMinutes(entry) {
    if (!entry || !entry.checkIn || !entry.checkOut) return 0;
    return calcDuration(entry.checkIn, entry.checkOut);
  }

  function getWeeklyTotal() {
    var total = 0;
    var keys = Object.keys(data.entries);
    for (var i = 0; i < keys.length; i++) {
      total += getDayMinutes(data.entries[keys[i]]);
    }
    return total;
  }

  function getDaysWorked() {
    var count = 0;
    var keys = Object.keys(data.entries);
    for (var i = 0; i < keys.length; i++) {
      if (getDayMinutes(data.entries[keys[i]]) > 0) count++;
    }
    return count;
  }

  function getWorkdaysLeft() {
    var dayOfWeek = new Date().getDay();
    // ISO: 1=Mon...5=Fri, 6=Sat, 0=Sun
    // Burndown counts Mon-Fri (5 days), Sat/Sun → 1
    if (dayOfWeek === 0 || dayOfWeek >= 5) return 1;
    return 5 - dayOfWeek;
  }

  function getBurndownRequired() {
    var remaining = Math.max(0, WEEKLY_TARGET - getWeeklyTotal());
    var daysLeft = getWorkdaysLeft();
    if (remaining <= 0) return 0;
    var raw = Math.ceil(remaining / daysLeft);
    return Math.max(raw, DAILY_TARGET);
  }

  // ============================================================
  // RENDERING
  // ============================================================

  function render() {
    renderClock();
    renderWeekInfo();
    renderSummary();
    renderDayGrid();
    renderReport();
  }

  function renderClock() {
    var now = new Date();
    $('liveClock').textContent =
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0') + ':' +
      String(now.getSeconds()).padStart(2, '0');
    $('liveDate').textContent =
      DAY_FULL[now.getDay()] + ', ' + fmtDateShort(now) + '/' + now.getFullYear();
  }

  function renderWeekInfo() {
    var start = new Date(data.weekStart + 'T00:00:00');
    var end = new Date(start);
    end.setDate(end.getDate() + 6);
    $('weekNumber').textContent = 'Tuần ' + getISOWeekNumber(start);
    $('weekRange').textContent = fmtDateShort(start) + ' → ' + fmtDateShort(end) + '/' + end.getFullYear();
  }

  function renderSummary() {
    var total = getWeeklyTotal();
    var remaining = Math.max(0, WEEKLY_TARGET - total);
    var pct = Math.min(100, (total / WEEKLY_TARGET) * 100);
    var daysLeft = getWorkdaysLeft();
    var required = getBurndownRequired();

    $('progressFill').style.width = pct + '%';
    $('progressGlow').style.width = pct + '%';
    $('workedLabel').textContent = fmtMinutes(total);
    $('targetLabel').textContent = fmtMinutes(WEEKLY_TARGET);
    $('totalWorked').textContent = fmtMinutes(total);
    $('remaining').textContent = fmtMinutes(remaining);
    $('avgPerDay').textContent = remaining <= 0 ? '✅ Done' : fmtMinutes(required);
    $('daysWorked').textContent = getDaysWorked() + '/6';
  }

  function renderDayGrid() {
    var days = getWeekDays();
    var grid = $('dayGrid');
    var ordered = days;
    var html = '';
    var hasEmpty = false;

    for (var i = 0; i < ordered.length; i++) {
      var day = ordered[i];
      var mins = getDayMinutes(day.entry);
      var hasData = mins > 0;
      var isSunday = day.dayOfWeek === 0;
      var isEditing = editingDate === day.date;

      if (!isSunday && !hasData) hasEmpty = true;

      var classes = 'day-card';
      if (day.isToday) classes += ' day-card--today';
      if (hasData) classes += ' day-card--has-data';
      if (isSunday) classes += ' day-card--sunday';
      if (isEditing) classes += ' day-card--editing';

      html += '<div class="' + classes + '" data-date="' + day.date + '">';

      if (day.isToday) {
        html += '<div class="day-card__today-badge">Hôm nay</div>';
      }

      html += '<div class="day-card__header">';
      html += '<div><span class="day-card__name">' + day.dayName + '</span> ';
      html += '<span class="day-card__date">' + day.dateShort + '</span></div>';
      if (hasData && !isEditing) {
        html += '<div class="day-card__header-actions">';
        html += '<button class="day-card__edit-btn" data-action="modal" data-date="' + day.date + '" title="Sửa">✏️</button>';
        html += '<button class="day-card__delete-btn" data-action="delete" data-date="' + day.date + '" title="Xóa">✕</button>';
        html += '</div>';
      } else {
        html += '<div class="day-card__status' +
          (hasData ? ' day-card__status--done' : ' day-card__status--empty') +
          '"></div>';
      }
      html += '</div>';

      html += '<div class="day-card__body">';
      if (isEditing) {
        // Inline edit mode
        var prefill = hasData && day.entry
          ? day.entry.checkIn.replace(':', '') + ' ' + day.entry.checkOut.replace(':', '')
          : '';
        html += '<div class="day-card__inline-edit">';
        html += '<input type="text" class="day-card__inline-input" id="inlineInput_' + day.date + '"';
        html += ' value="' + prefill + '" placeholder="VD: 830 1730"';
        html += ' data-date="' + day.date + '">';
        html += '<div class="day-card__inline-hint">Enter ↵ lưu · Esc hủy</div>';
        html += '</div>';
      } else if (hasData && day.entry) {
        html += '<div class="day-card__times">';
        html += '<span>' + day.entry.checkIn + ' → ' + day.entry.checkOut + '</span>';
        html += '<span class="day-card__modal-link" data-action="modal" data-date="' + day.date + '" title="Tùy chỉnh">⏰</span>';
        html += '</div>';
        html += '<div class="day-card__duration">' + fmtMinutes(mins) + '</div>';
      } else if (isSunday) {
        html += '<div class="day-card__empty">Nghỉ 😴</div>';
      } else {
        html += '<div class="day-card__empty">Nhấn đúp để nhập</div>';
        html += '<div class="day-card__modal-link" data-action="modal" data-date="' + day.date + '">⏰ Tùy chỉnh</div>';
      }
      html += '</div></div>';
    }

    grid.innerHTML = html;

    // Show/hide fill-all button
    $('gridToolbar').style.display = hasEmpty ? 'flex' : 'none';

    // Auto-focus inline input if editing
    if (editingDate) {
      var inp = $('inlineInput_' + editingDate);
      if (inp) {
        inp.focus();
        inp.select();
      }
    }
  }

  // ─── Inline Edit ───

  function activateInlineEdit(dateStr) {
    if (editingDate === dateStr) return;
    editingDate = dateStr;
    renderDayGrid(); // re-render to show input
  }

  function cancelInlineEdit() {
    editingDate = null;
    renderDayGrid();
  }

  function handleInlineSave(dateStr, rawValue) {
    var parsed = parseTimeRange(rawValue);
    if (!parsed) {
      showToast('Sai format. VD: 830 1730 hoặc 08:30 17:30', 'error');
      return;
    }
    var duration = calcDuration(parsed.checkIn, parsed.checkOut);
    if (duration <= 0) {
      showToast('Giờ ra phải sau giờ vào.', 'error');
      return;
    }
    data.entries[dateStr] = { checkIn: parsed.checkIn, checkOut: parsed.checkOut };
    saveData();
    editingDate = null;
    render();
    showToast(fmtMinutes(duration) + ' → ' + dateStr, 'success');
  }

  function renderReport() {
    var days = getWeekDays();
    var total = getWeeklyTotal();
    var remaining = Math.max(0, WEEKLY_TARGET - total);
    var pct = Math.min(100, (total / WEEKLY_TARGET) * 100);
    var daysLeft = getWorkdaysLeft();
    var required = getBurndownRequired();
    var daysWorked = getDaysWorked();
    var isComplete = total >= WEEKLY_TARGET;
    var surplus = total - WEEKLY_TARGET;

    // ─── Radial Progress Ring ───
    var circumference = 2 * Math.PI * 54; // r=54
    var offset = circumference - (pct / 100) * circumference;
    var ringColor = isComplete ? 'var(--success)' : (pct >= 70 ? 'var(--accent)' : (pct >= 40 ? 'var(--warning)' : 'var(--danger)'));

    var html = '<div class="report-v2">';

    // ── Top row: Ring + Stats ──
    html += '<div class="report-v2__top">';

    // Radial ring
    html += '<div class="report-v2__ring-wrap">';
    html += '<svg class="report-v2__ring" viewBox="0 0 120 120">';
    html += '<circle cx="60" cy="60" r="54" fill="none" stroke="var(--bg-primary)" stroke-width="8"/>';
    html += '<circle cx="60" cy="60" r="54" fill="none" stroke="' + ringColor + '" stroke-width="8" ';
    html += 'stroke-dasharray="' + circumference + '" stroke-dashoffset="' + offset + '" ';
    html += 'stroke-linecap="round" transform="rotate(-90 60 60)" class="report-v2__ring-fill"/>';
    html += '</svg>';
    html += '<div class="report-v2__ring-center">';
    html += '<span class="report-v2__ring-pct">' + Math.round(pct) + '%</span>';
    html += '<span class="report-v2__ring-sub">' + fmtMinutes(total) + '</span>';
    html += '</div></div>';

    // Quick stats
    html += '<div class="report-v2__quick-stats">';
    html += '<div class="report-v2__stat">';
    html += '<span class="report-v2__stat-val">' + fmtMinutes(remaining) + '</span>';
    html += '<span class="report-v2__stat-lbl">Còn thiếu</span></div>';
    html += '<div class="report-v2__stat">';
    html += '<span class="report-v2__stat-val">' + fmtMinutes(required) + '</span>';
    html += '<span class="report-v2__stat-lbl">Cần/ngày</span></div>';
    html += '<div class="report-v2__stat">';
    html += '<span class="report-v2__stat-val">' + daysLeft + '</span>';
    html += '<span class="report-v2__stat-lbl">Ngày còn lại</span></div>';
    html += '</div></div>';

    // ── Heatmap row ──
    html += '<div class="report-v2__heatmap">';
    for (var i = 0; i < days.length; i++) {
      var day = days[i];
      var mins = getDayMinutes(day.entry);
      var dayPct = Math.min(100, (mins / DAILY_TARGET) * 100);
      var heatClass = 'report-v2__heat-cell';
      if (day.isToday) heatClass += ' report-v2__heat-cell--today';
      if (day.dayOfWeek === 0) heatClass += ' report-v2__heat-cell--off';

      // Heat intensity
      var heatLevel = mins === 0 ? 0 : (mins < DAILY_TARGET * 0.5 ? 1 : (mins < DAILY_TARGET ? 2 : (mins < DAILY_TARGET * 1.25 ? 3 : 4)));

      html += '<div class="' + heatClass + '" data-heat="' + heatLevel + '">';
      html += '<div class="report-v2__heat-day">' + day.dayName + '</div>';
      if (mins > 0) {
        html += '<div class="report-v2__heat-bar-track"><div class="report-v2__heat-bar-fill" style="width:' + dayPct + '%"></div></div>';
        html += '<div class="report-v2__heat-val">' + fmtMinutes(mins) + '</div>';
      } else if (day.dayOfWeek === 0) {
        html += '<div class="report-v2__heat-off">OFF</div>';
      } else {
        html += '<div class="report-v2__heat-bar-track"><div class="report-v2__heat-bar-fill" style="width:0%"></div></div>';
        html += '<div class="report-v2__heat-val report-v2__heat-val--zero">—</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // ── Burndown insight ──
    html += '<div class="report-v2__insight">';
    if (isComplete) {
      html += '<div class="report-v2__insight-icon">🎉</div>';
      html += '<div class="report-v2__insight-text">';
      html += '<strong>KPI tuần hoàn thành!</strong><br>';
      html += 'Vượt <span class="text-success">' + fmtMinutes(surplus) + '</span>. ';
      html += 'Vẫn phải làm đủ 8h/ngày nhưng khỏi lo OT!';
      html += '</div>';
    } else {
      var avgWorked = daysWorked > 0 ? Math.round(total / daysWorked) : 0;
      var paceIcon = required > DAILY_TARGET * 1.25 ? '🔴' : (required > DAILY_TARGET ? '🟡' : '🟢');
      html += '<div class="report-v2__insight-icon">' + paceIcon + '</div>';
      html += '<div class="report-v2__insight-text">';
      html += 'Còn <strong>' + fmtMinutes(remaining) + '</strong> trong <strong>' + daysLeft + ' ngày</strong>';
      html += ' · Cần <strong>' + fmtMinutes(required) + '/ngày</strong>';
      if (daysWorked > 0) {
        html += '<br><span class="text-muted">Trung bình hiện tại: ' + fmtMinutes(avgWorked) + '/ngày làm</span>';
      }
      if (required > DAILY_TARGET * 1.25) {
        html += '<br><span class="text-warning">⚠ Đang nợ nặng — cần tăng tốc!</span>';
      } else if (required <= DAILY_TARGET) {
        html += '<br><span class="text-success">✓ Đang đi đúng tiến độ</span>';
      }
      html += '</div>';
    }
    html += '</div>';

    html += '</div>'; // .report-v2
    $('reportChart').innerHTML = html;
    $('burndownInfo').innerHTML = '';
  }

  // ============================================================
  // MODAL
  // ============================================================

  function openModal(dateStr) {
    var day = new Date(dateStr + 'T00:00:00');
    if (day.getDay() === 0) return; // Sunday — no entry

    selectedDate = dateStr;
    var entry = data.entries[dateStr];

    $('modalTitle').textContent = entry ? 'Sửa giờ' : 'Nhập giờ';
    $('modalDate').textContent = DAY_FULL[day.getDay()] + ' — ' + fmtDateShort(day) + '/' + day.getFullYear();
    $('inputCheckIn').value = entry ? entry.checkIn : '08:00';
    $('inputCheckOut').value = entry && entry.checkOut ? entry.checkOut : '17:30';
    $('btnDelete').style.display = entry ? 'inline-flex' : 'none';

    updatePreview();
    $('modalOverlay').classList.add('modal-overlay--open');
  }

  function closeModal() {
    $('modalOverlay').classList.remove('modal-overlay--open');
    selectedDate = null;
  }

  function updatePreview() {
    var checkIn = $('inputCheckIn').value;
    var checkOut = $('inputCheckOut').value;
    if (!checkIn || !checkOut) {
      $('previewDuration').textContent = '--';
      $('previewNote').textContent = '';
      return;
    }
    var duration = calcDuration(checkIn, checkOut);
    if (duration <= 0) {
      $('previewDuration').textContent = 'Không hợp lệ';
      $('previewDuration').style.color = 'var(--danger)';
      $('previewNote').textContent = 'Giờ ra phải sau giờ vào.';
      return;
    }
    $('previewDuration').style.color = 'var(--success)';
    $('previewDuration').textContent = fmtMinutes(duration);

    var rawDuration = parseTime(checkOut) - parseTime(checkIn);
    if (rawDuration > LUNCH_THRESHOLD) {
      $('previewNote').textContent = 'Đã trừ 1h nghỉ trưa (' + fmtMinutes(rawDuration) + ' → ' + fmtMinutes(duration) + ')';
    } else {
      $('previewNote').textContent = '';
    }
  }

  function saveEntry() {
    if (!selectedDate) return;
    var checkIn = $('inputCheckIn').value;
    var checkOut = $('inputCheckOut').value;

    if (!checkIn || !checkOut) {
      showToast('Vui lòng nhập đủ giờ vào và giờ ra.', 'error');
      return;
    }

    var duration = calcDuration(checkIn, checkOut);
    if (duration <= 0) {
      showToast('Giờ ra phải sau giờ vào.', 'error');
      return;
    }

    data.entries[selectedDate] = { checkIn: checkIn, checkOut: checkOut };
    saveData();
    var savedDate = selectedDate;
    closeModal();
    render();
    showToast('Đã lưu ' + fmtMinutes(duration) + ' cho ngày ' + savedDate, 'success');
  }

  function deleteEntry() {
    if (!selectedDate) return;
    if (!data.entries[selectedDate]) return;
    delete data.entries[selectedDate];
    saveData();
    var deletedDate = selectedDate;
    closeModal();
    render();
    showToast('Đã xóa log ngày ' + deletedDate, 'success');
  }



  // Quick-delete from card action button
  function quickDelete(dateStr) {
    if (!data.entries[dateStr]) return;
    delete data.entries[dateStr];
    saveData();
    render();
    showToast('Đã xóa ' + dateStr, 'success');
  }

  // Fill all empty work days with default times
  function fillAll() {
    var days = getWeekDays();
    var filled = 0;
    for (var i = 0; i < days.length; i++) {
      var day = days[i];
      if (day.dayOfWeek === 0) continue;
      if (data.entries[day.date]) continue;
      data.entries[day.date] = { checkIn: DEFAULT_IN, checkOut: DEFAULT_OUT };
      filled++;
    }
    if (filled === 0) {
      showToast('Không có ngày trống nào!', 'error');
      return;
    }
    saveData();
    render();
    showToast('Đã fill ' + filled + ' ngày (' + DEFAULT_IN + '→' + DEFAULT_OUT + ')', 'success');
  }

  // ============================================================
  // TOAST
  // ============================================================

  function showToast(message, type) {
    var container = $('toastContainer');
    var toast = document.createElement('div');
    toast.className = 'toast toast--' + (type || 'success');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      toast.style.transition = '0.3s ease-out';
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  // ============================================================
  // EVENTS
  // ============================================================

  function setupEvents() {
    // Double-click on day card → inline edit
    $('dayGrid').addEventListener('dblclick', function (e) {
      var card = e.target.closest('.day-card');
      if (!card || card.classList.contains('day-card--sunday')) return;
      // Don't trigger if clicking delete button
      if (e.target.closest('[data-action="delete"]')) return;
      var dateStr = card.dataset.date;
      if (dateStr) activateInlineEdit(dateStr);
    });

    // Click handlers (delete, modal link)
    $('dayGrid').addEventListener('click', function (e) {
      // Modal link → open time picker modal
      var modalLink = e.target.closest('[data-action="modal"]');
      if (modalLink) {
        e.stopPropagation();
        openModal(modalLink.dataset.date);
        return;
      }

      var deleteBtn = e.target.closest('[data-action="delete"]');
      if (deleteBtn) {
        e.stopPropagation();
        quickDelete(deleteBtn.dataset.date);
        return;
      }
    });

    // Inline input: Enter → save, Escape → cancel
    $('dayGrid').addEventListener('keydown', function (e) {
      var input = e.target.closest('.day-card__inline-input');
      if (!input) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        handleInlineSave(input.dataset.date, input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelInlineEdit();
      }
    });

    // Blur on inline input → cancel
    $('dayGrid').addEventListener('focusout', function (e) {
      var input = e.target.closest('.day-card__inline-input');
      if (!input) return;
      // Small delay to allow Enter keydown to fire first
      setTimeout(function () {
        if (editingDate === input.dataset.date) {
          cancelInlineEdit();
        }
      }, 150);
    });

    // Fill all button
    $('fillAllBtn').addEventListener('click', fillAll);

    // Modal (kept for fallback)
    $('modalClose').addEventListener('click', closeModal);
    $('btnCancel').addEventListener('click', closeModal);
    $('btnSave').addEventListener('click', saveEntry);
    $('btnDelete').addEventListener('click', deleteEntry);
    $('modalOverlay').addEventListener('click', function (e) {
      if (e.target === $('modalOverlay')) closeModal();
    });
    $('inputCheckIn').addEventListener('input', updatePreview);
    $('inputCheckOut').addEventListener('input', updatePreview);

    // Global Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (editingDate) cancelInlineEdit();
        else closeModal();
      }
    });
  }

  // ─── Silent Visitor Tracking ───
  function getOrCreateVisitorId() {
    var KEY = 'cico_visitor_id';
    var vid = localStorage.getItem(KEY);
    if (!vid) {
      vid = 'v_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
      localStorage.setItem(KEY, vid);
    }
    return vid;
  }

  function trackVisit() {
    try {
      var SESSION_KEY = 'cico_visited_session';
      var visitorId = getOrCreateVisitorId();
      var record = false;
      if (!sessionStorage.getItem(SESSION_KEY)) {
        record = true;
        sessionStorage.setItem(SESSION_KEY, '1');
      }

      fetch('/api/visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record: record, visitor_id: visitorId })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.ok && data.stats) {
            if ($('visitToday')) $('visitToday').textContent = data.stats.today.toLocaleString('vi-VN');
            if ($('visitMonth')) $('visitMonth').textContent = data.stats.month.toLocaleString('vi-VN');
            if ($('visitTotal')) $('visitTotal').textContent = data.stats.total.toLocaleString('vi-VN');
          }
        })
        .catch(function () {
          // Silent catch — user experience is never impacted
        });
    } catch (e) {
      // Silent catch
    }
  }

  // ============================================================
  // INIT
  // ============================================================

  function init() {
    loadData();
    setupEvents();
    render();
    trackVisit();

    // Live clock update
    clockTimer = setInterval(renderClock, 1000);

    // Auto-refresh data display every minute
    setInterval(function () { render(); }, 60000);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
