/* ================================================================
   CI/CO Dashboard — Theme & Sky
   - Sáng/tối: lưu localStorage (cico_theme), chưa chọn thì theo hệ điều hành.
     Script nhỏ trong <head> đã gắn data-theme trước khi vẽ để không nháy.
   - Nút chuyển: hiệu ứng lan tròn từ nút (View Transitions API, nếu có).
   - Dựng nền trời (sky.css):
       #sky      (sau nội dung): đêm trăng + thành phố lên đèn + mưa sao băng / hoàng hôn + mây
       #skyFront (trước nội dung): máy bay kéo băng rôn, bầy chim, cầu lửa
   - Máy bật "giảm chuyển động" vẫn có hiệu ứng, chỉ thưa hơn và không mưa bão sao băng.
   - Thử nhanh trong console: cicoSky.plane(), cicoSky.flock('cluster'), cicoSky.storm(), cicoSky.fireball()
   ================================================================ */

(function () {
  'use strict';

  var THEME_KEY = 'cico_theme';
  var THEME_COLORS = { dark: '#04060e', light: '#c9d3fb' };
  var SYNODIC_MONTH = 29.530588853;
  var KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // trăng non 06/01/2000 18:14 UTC

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var systemLight = window.matchMedia('(prefers-color-scheme: light)');

  // ─── Utils ───
  var $ = function (id) { return document.getElementById(id); };

  // Số giả ngẫu nhiên cố định → mây, nhà cửa không đổi hình mỗi lần tải
  function seeded(a, b) {
    return function (i) {
      var x = Math.sin(i * a + b) * 43758.5453;
      return x - Math.floor(x);
    };
  }
  var rnd = seeded(41.37, 1.9);
  var rndCity = seeded(12.9898, 4.1);

  function rand(min, max) { return min + Math.random() * (max - min); }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function isMobile() { return window.innerWidth <= 640; }

  function isDark() { return currentTheme() === 'dark'; }

  function clearHost(id) {
    var host = $(id);
    if (host) host.replaceChildren();
  }

  // ============================================================
  // THEME
  // ============================================================

  function getSavedTheme() {
    try {
      var t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : null;
    } catch (e) {
      return null;
    }
  }

  function currentTheme() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    var meta = $('metaThemeColor');
    if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
    var btn = $('themeToggle');
    if (btn) {
      var dark = theme === 'dark';
      btn.setAttribute('aria-checked', String(dark));
      btn.setAttribute('title', dark ? 'Đang ở giao diện tối — bấm để chuyển sáng' : 'Đang ở giao diện sáng — bấm để chuyển tối');
    }
  }

  function setTheme(theme, originEl) {
    if (theme === currentTheme()) return;
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* private mode */ }

    if (!document.startViewTransition) {
      applyTheme(theme);
      onThemeChanged(theme);
      return;
    }

    // Lan tròn từ tâm nút ra góc xa nhất màn hình
    var rect = originEl ? originEl.getBoundingClientRect() : null;
    var x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    var y = rect ? rect.top + rect.height / 2 : 0;
    var r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    root.classList.add('theme-switching');
    var transition = document.startViewTransition(function () { applyTheme(theme); });
    transition.ready.then(function () {
      root.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 750, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(function () { /* bỏ qua */ });
    transition.finished.finally(function () {
      root.classList.remove('theme-switching');
      onThemeChanged(theme);
    });
  }

  // Dọn vật bay của theme cũ, rồi mừng theme mới: tối → chùm sao băng, sáng → bầy chim; sau đó máy bay ghé
  function onThemeChanged(theme) {
    setTimeout(function () {
      if (theme === 'dark') { clearHost('skyFrontDay'); } else { clearHost('skyFrontNight'); clearHost('skyMeteors'); }
    }, 900);
    if (theme === 'dark') meteorBurst(5);
    else spawnFlock('v');
    setTimeout(function () { spawnPlane(theme); }, 1400);
  }

  function setupToggle() {
    var btn = $('themeToggle');
    if (!btn) return;
    applyTheme(currentTheme());
    btn.addEventListener('click', function () {
      setTheme(isDark() ? 'light' : 'dark', btn);
    });

    // Chưa tự chọn thì đi theo hệ điều hành
    var onSystemChange = function () {
      if (getSavedTheme()) return;
      applyTheme(systemLight.matches ? 'light' : 'dark');
    };
    if (systemLight.addEventListener) systemLight.addEventListener('change', onSystemChange);
    else if (systemLight.addListener) systemLight.addListener(onSystemChange);
  }

  // ============================================================
  // SKY — ĐÊM
  // ============================================================

  // [left %, top %, cỡ px, thời lượng s]
  var BRIGHT_STARS = [
    [6, 6, 20, 5], [19, 15, 14, 6.5], [33, 4, 18, 4.8], [47, 11, 12, 7], [58, 3, 16, 5.6],
    [71, 17, 13, 6], [84, 30, 18, 5.2], [92, 8, 14, 7.4], [12, 34, 12, 6.2], [40, 26, 11, 4.4], [64, 38, 12, 5.8]
  ];

  // Chú Cuội ngồi gốc cây đa (viewBox 64 → phóng lên 100)
  var CUOI_PATHS =
    '<path d="M28 26 C26 18 32 13 38 14 C42 9 50 11 51 17 C57 18 58 26 53 29 C54 34 48 37 44 35 C40 38 32 36 32 32 C27 32 26 28 28 26 Z"/>' +
    '<path d="M40 34 C40 40 39 44 37 48 L45 48 C43 44 42 40 42 34 Z"/>' +
    '<path d="M28 48 Q41 46 54 48 Q41 50.5 28 48 Z"/>' +
    '<circle cx="31" cy="40.5" r="2"/>' +
    '<path d="M29.5 42.6 L32.6 42.6 L33.6 46.6 L36.2 46.6 L36.2 48.4 L29 48.4 Z"/>';

  function moonPhase(date) {
    var age = ((date.getTime() - KNOWN_NEW_MOON) / 86400000) % SYNODIC_MONTH;
    if (age < 0) age += SYNODIC_MONTH;
    var ph = (age / SYNODIC_MONTH) * 2 * Math.PI;
    // Luôn để lại ít nhất một vành trăng khuyết mảnh — đêm trăng non vẫn có trăng
    ph = Math.min(Math.max(ph, 0.6), 2 * Math.PI - 0.6);
    return { ph: ph, lit: (1 - Math.cos(ph)) / 2, waxing: ph < Math.PI };
  }

  function buildMoon() {
    var p = moonPhase(new Date());
    // Phần sáng = nửa đĩa + elip đường ranh sáng tối (bán cầu Bắc: trăng tròn dần sáng bên phải)
    var rx = (Math.abs(Math.cos(p.ph)) * 50).toFixed(2);
    var sweep = p.waxing ? 1 : 0;
    var ts = p.waxing ? (p.lit < 0.5 ? 0 : 1) : (p.lit < 0.5 ? 1 : 0);
    var lit = 'M50 0 A50 50 0 0 ' + sweep + ' 50 100 A' + rx + ' 50 0 0 ' + ts + ' 50 0 Z';
    var glow = 'drop-shadow(0 0 ' + (4 + 14 * p.lit).toFixed(0) + 'px rgba(240,244,255,' + (0.35 + 0.45 * p.lit).toFixed(2) + ')) ' +
      'drop-shadow(0 0 ' + (10 + 30 * p.lit).toFixed(0) + 'px rgba(200,215,250,' + (0.15 + 0.3 * p.lit).toFixed(2) + '))';

    return '' +
      '<span class="sky-moon-halo" style="--halo:' + (0.06 + 0.2 * p.lit).toFixed(3) + '"></span>' +
      '<svg class="sky-moon" viewBox="0 0 100 100" style="filter:' + glow + '">' +
        '<defs>' +
          '<radialGradient id="skyMoonLit" cx="40%" cy="38%" r="68%">' +
            '<stop offset="0" stop-color="#FDFCF5"/><stop offset="0.62" stop-color="#E9EAF0"/><stop offset="1" stop-color="#C6CCDD"/>' +
          '</radialGradient>' +
          '<clipPath id="skyMoonPhase"><path d="' + lit + '"/></clipPath>' +
        '</defs>' +
        '<circle cx="50" cy="50" r="49.5" fill="rgba(170,190,230,0.07)" stroke="rgba(200,215,245,0.14)" stroke-width="1"/>' +
        '<g clip-path="url(#skyMoonPhase)">' +
          '<circle cx="50" cy="50" r="50" fill="url(#skyMoonLit)"/>' +
          '<circle cx="30" cy="62" r="9" fill="rgba(150,160,180,0.28)"/>' +
          '<circle cx="64" cy="28" r="11" fill="rgba(150,160,180,0.22)"/>' +
          '<circle cx="58" cy="72" r="7" fill="rgba(150,160,180,0.2)"/>' +
          '<circle cx="76" cy="52" r="4" fill="rgba(150,160,180,0.2)"/>' +
          '<g transform="scale(1.5625)" fill="rgba(110,120,152,0.42)">' + CUOI_PATHS + '</g>' +
        '</g>' +
      '</svg>';
  }

  // ─── Thành phố lên đèn ───
  // Dãy xa: thấp hơn, xanh mờ, đèn thưa. Dãy gần: tối, cửa sổ vàng/cam/xanh, vài toà có cột ăng-ten đèn đỏ.
  // ~15% cửa sổ chia vào 3 cụm bật/tắt theo nhịp khác nhau cho thành phố "sống".
  var WINDOW_COLORS = ['#fde68a', '#fde68a', '#fde68a', '#fcd34d', '#fdba74', '#fdba74', '#bae6fd', '#c4b5fd'];

  function buildCity(far, width, mobile) {
    var W = Math.ceil(width), H = far ? (mobile ? 120 : 190) : (mobile ? 96 : 160);
    var seed = far ? 5000 : 0;
    var body = far ? '#0d1433' : '#050816';
    var gap = far ? 5 : 7, win = far ? 2 : 3;
    var bodies = '', beacons = '', lights = ['', '', '', ''];
    var x = -6, i = 0;

    while (x < W) {
      var r = function (j) { return rndCity(seed + i * 17 + j); };
      var w = (far ? 16 : 24) + r(1) * (far ? 30 : 46);
      var h = H * ((far ? 0.38 : 0.22) + r(2) * (far ? 0.55 : 0.6));
      // Mobile: nhà thấp lại để không che nội dung quá nhiều
      if (mobile) h *= 0.85;
      var top = H - h, roof = r(3);
      bodies += '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '"/>';

      if (roof < 0.18 && !far && h > H * 0.5) {
        // Cột ăng-ten + đèn báo hàng không
        var ax = x + w / 2, ah = 10 + r(4) * 16;
        bodies += '<rect x="' + (ax - 0.8).toFixed(1) + '" y="' + (top - ah).toFixed(1) + '" width="1.6" height="' + ah.toFixed(1) + '"/>';
        beacons += '<circle cx="' + ax.toFixed(1) + '" cy="' + (top - ah).toFixed(1) + '" r="1.8" fill="#f87171"/>' +
          '<circle cx="' + ax.toFixed(1) + '" cy="' + (top - ah).toFixed(1) + '" r="5" fill="rgba(248,113,113,0.25)"/>';
      } else if (roof < 0.36) {
        // Mái bậc thang
        var sw = w * (0.45 + r(5) * 0.25), sh = 6 + r(6) * 10;
        bodies += '<rect x="' + (x + (w - sw) / 2).toFixed(1) + '" y="' + (top - sh).toFixed(1) + '" width="' + sw.toFixed(1) + '" height="' + (sh + 1).toFixed(1) + '"/>';
      } else if (roof < 0.46) {
        // Chóp nhọn
        bodies += '<path d="M' + x.toFixed(1) + ' ' + (top + 0.5).toFixed(1) + ' L' + (x + w / 2).toFixed(1) + ' ' + (top - 8 - r(7) * 14).toFixed(1) +
          ' L' + (x + w).toFixed(1) + ' ' + (top + 0.5).toFixed(1) + ' Z"/>';
      }

      // Cửa sổ
      var cols = Math.floor((w - 6) / gap), rows = Math.floor((h - 8) / (gap + 2));
      var litRate = far ? 0.22 : 0.3;
      for (var c = 0; c < cols; c++) {
        for (var rr = 0; rr < rows; rr++) {
          var k = c * 31 + rr * 7;
          if (rndCity(seed + i * 101 + k) > litRate) continue;
          var color = WINDOW_COLORS[Math.floor(rndCity(seed + i * 211 + k) * WINDOW_COLORS.length)];
          var g = rndCity(seed + i * 307 + k);
          var group = g < 0.85 ? 0 : (g < 0.9 ? 1 : (g < 0.95 ? 2 : 3));
          lights[group] += '<rect x="' + (x + 4 + c * gap).toFixed(1) + '" y="' + (top + 6 + rr * (gap + 2)).toFixed(1) +
            '" width="' + win + '" height="' + (win + 1) + '" fill="' + color + '"/>';
        }
      }

      x += w + r(8) * (far ? 2 : 4) - (far ? 3 : 0);
      i++;
    }

    return '<svg class="sky-city sky-city--' + (far ? 'far' : 'near') + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMax slice">' +
      '<g fill="' + body + '">' + bodies + '</g>' +
      '<g class="city-lights">' + lights[0] +
        '<g class="city-blink">' + lights[1] + '</g>' +
        '<g class="city-blink city-blink--2">' + lights[2] + '</g>' +
        '<g class="city-blink city-blink--3">' + lights[3] + '</g>' +
      '</g>' +
      (beacons ? '<g class="city-beacon">' + beacons + '</g>' : '') +
      '</svg>';
  }

  var builtWidth = 0;

  function buildNight() {
    var mobile = isMobile();
    builtWidth = Math.max(window.innerWidth, mobile ? 390 : 1440);
    var html = '<div class="sky-aurora"></div>' +
      '<div class="sky-milkyway"></div>' +
      '<div class="sky-milkyway sky-milkyway--dust"></div>';
    for (var i = 0; i < 4; i++) html += '<div class="sky-stars sky-stars--' + i + '"></div>';
    for (var j = 0; j < BRIGHT_STARS.length; j++) {
      if (mobile && j % 2) continue;
      var s = BRIGHT_STARS[j];
      html += '<span class="sky-bright-star" style="left:' + s[0] + '%;top:' + s[1] + '%;width:' + s[2] + 'px;height:' + s[2] +
        'px;animation-duration:' + s[3] + 's;animation-delay:' + (-j * 1.3).toFixed(1) + 's"></span>';
    }
    html += '<div class="sky-comet"><span class="sky-comet__tail"></span><span class="sky-comet__head"></span></div>';
    html += buildMoon();
    html += '<div class="sky-host" id="skyMeteors"></div>';
    html += '<div class="sky-city-glow"></div>';
    html += buildCity(true, builtWidth, mobile) + buildCity(false, builtWidth, mobile);
    return html;
  }

  // ─── Mưa sao băng ───
  // Cùng một hướng (từ điểm radiant phía trên bên phải) như mưa sao băng thật; 30% có màu vàng/tím
  function spawnMeteor(angle) {
    var host = $('skyMeteors');
    if (!host || host.childElementCount > 18) return;
    var mobile = isMobile();
    var big = Math.random() < 0.12;
    var len = (mobile ? rand(60, 130) : rand(90, 240)) * (big ? 1.4 : 1);
    var tint = Math.random();
    var m = document.createElement('span');
    m.className = 'meteor' + (tint < 0.15 ? ' meteor--gold' : (tint < 0.3 ? ' meteor--violet' : '')) + (big ? ' meteor--big' : '');
    m.style.left = rand(20, 105).toFixed(1) + '%';
    m.style.top = rand(-4, 45).toFixed(1) + '%';
    m.style.width = len.toFixed(0) + 'px';
    m.style.setProperty('--angle', (angle || rand(140, 152)).toFixed(1) + 'deg');
    m.style.setProperty('--dist', (len * 2 + rand(180, 380)).toFixed(0) + 'px');
    m.style.animationDuration = rand(0.8, 1.6).toFixed(2) + 's';
    m.addEventListener('animationend', function () { m.remove(); });
    host.appendChild(m);
  }

  function meteorBurst(n) {
    var angle = rand(142, 150);
    for (var i = 0; i < n; i++) {
      setTimeout(function () { spawnMeteor(angle + rand(-2, 2)); }, i * rand(120, 320));
    }
  }

  // Mưa bão sao băng: một đợt dày 12–18 vệt trong ~4 giây
  function meteorStorm() {
    var n = 12 + Math.floor(Math.random() * 7);
    var angle = rand(142, 150);
    for (var i = 0; i < n; i++) {
      setTimeout(function () { spawnMeteor(angle + rand(-3, 3)); }, i * rand(160, 300));
    }
  }

  // Cầu lửa: sao băng lớn màu cam vàng, bay ở lớp trước
  function spawnFireball() {
    var host = $('skyFrontNight');
    if (!host || host.querySelector('.fireball')) return;
    var len = isMobile() ? rand(150, 220) : rand(260, 400);
    var f = document.createElement('span');
    f.className = 'fireball';
    f.style.left = rand(40, 100).toFixed(1) + '%';
    f.style.top = rand(-6, 22).toFixed(1) + '%';
    f.style.width = len.toFixed(0) + 'px';
    f.style.setProperty('--angle', rand(142, 150).toFixed(1) + 'deg');
    f.style.setProperty('--dist', (len * 1.6 + rand(320, 520)).toFixed(0) + 'px');
    f.style.animationDuration = rand(2, 2.8).toFixed(2) + 's';
    f.addEventListener('animationend', function () { f.remove(); });
    host.appendChild(f);
  }

  // ============================================================
  // SKY — HOÀNG HÔN
  // ============================================================

  // Mây: [left, top, rộng, cao] theo tỉ lệ khung; bụng mây ánh hồng/cam ráng chiều
  var CLOUDS = [[-0.06, 0.02, 0.3, 0.14], [0.36, -0.01, 0.24, 0.1], [0.74, 0.2, 0.3, 0.14], [0.2, 0.18, 0.13, 0.06],
    [0.56, 0.4, 0.14, 0.06], [-0.05, 0.74, 0.34, 0.15], [0.66, 0.8, 0.38, 0.16]];
  var CLOUDS_M = [[-0.14, 0.012, 0.62, 0.1], [0.5, 0.16, 0.6, 0.09], [0.12, 0.42, 0.4, 0.055], [-0.16, 0.8, 0.78, 0.11], [0.46, 0.88, 0.74, 0.11]];
  var CLOUD_TINT = ['246,190,214', '252,196,160'];
  // Hạt nắng: [left, top, cỡ, màu, thời lượng, trễ, dx]
  var MOTES = [[0.15, 0.9, 12, 0, 16, 0, 24], [0.42, 0.96, 9, 1, 19, 5, -20], [0.62, 0.9, 14, 2, 21, 9, 28],
    [0.84, 0.94, 10, 0, 17, 3, -22], [0.3, 0.8, 8, 1, 18, 11, 16], [0.72, 0.7, 7, 2, 20, 7, -14]];
  var MOTE_COLORS = ['253,186,116', '244,114,182', '251,146,60'];

  function buildCloud(c, i, W, H, mobile) {
    var w = c[2] * W, h = c[3] * H, low = c[1] > 0.5;
    var id = 'skyCloud' + i;
    var puffs = '';
    for (var k = 0; k < 6; k++) {
      var t = (k + 0.5) / 6;
      var r = h * (0.26 + 0.3 * Math.sin(Math.PI * t)) * (0.85 + 0.3 * rnd(i * 10 + k));
      puffs += '<circle cx="' + (w * (0.1 + 0.8 * t)).toFixed(1) + '" cy="' + (h - r * 0.8 - h * 0.1).toFixed(1) + '" r="' + r.toFixed(1) + '"/>';
    }
    var dx = (i % 2 ? -1 : 1) * (mobile ? 26 + rnd(i + 90) * 30 : 80 + rnd(i + 90) * 110);
    return '<span class="sky-cloud" style="left:' + (c[0] * 100).toFixed(2) + '%;top:' + (c[1] * 100).toFixed(2) + '%;--dx:' + dx.toFixed(0) +
      'px;animation-duration:' + (34 + rnd(i + 95) * 26).toFixed(0) + 's;animation-delay:' + (-rnd(i + 85) * 30).toFixed(1) + 's">' +
      '<svg width="' + w.toFixed(0) + '" height="' + h.toFixed(0) + '" viewBox="0 0 ' + w.toFixed(0) + ' ' + h.toFixed(0) + '" style="opacity:' + (low ? 0.85 : 0.95) +
      ';--by:' + ((mobile ? 5 : 8) + rnd(i + 70) * 8).toFixed(1) + 'px;animation-duration:' + (6 + rnd(i + 75) * 5).toFixed(1) + 's;animation-delay:' + (-rnd(i + 80) * 6).toFixed(1) +
      's;filter:drop-shadow(0 8px 14px rgba(' + CLOUD_TINT[1] + ',.3))">' +
        '<defs>' +
          '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="' + h.toFixed(0) + '">' +
            '<stop offset="0" stop-color="#FFF8F4"/><stop offset="0.45" stop-color="#FFF4F0"/><stop offset="1" stop-color="rgb(' + CLOUD_TINT[low ? 1 : 0] + ')"/>' +
          '</linearGradient>' +
          '<filter id="' + id + 'f" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>' +
        '</defs>' +
        '<g fill="url(#' + id + ')" filter="url(#' + id + 'f)">' + puffs +
          '<ellipse cx="' + (w / 2).toFixed(1) + '" cy="' + (h * 0.8).toFixed(1) + '" rx="' + (w * 0.46).toFixed(1) + '" ry="' + (h * 0.2).toFixed(1) + '"/>' +
        '</g>' +
      '</svg></span>';
  }

  function buildDay() {
    var mobile = isMobile();
    var W = mobile ? 390 : 1440, H = mobile ? 844 : 900;
    var html = '<div class="sky-dusk-glow"></div><div class="sky-light-band"></div>' +
      '<span class="sky-sun-halo"></span><span class="sky-sun"></span><span class="sky-sun-streaks"></span>';
    var clouds = mobile ? CLOUDS_M : CLOUDS;
    for (var i = 0; i < clouds.length; i++) html += buildCloud(clouds[i], i, W, H, mobile);
    for (var j = 0; j < MOTES.length; j++) {
      var o = MOTES[j], s = o[2] * (mobile ? 0.8 : 1), c = MOTE_COLORS[o[3]];
      html += '<span class="sky-mote" style="left:' + (o[0] * 100) + '%;top:' + (o[1] * 100) + '%;width:' + s + 'px;height:' + s + 'px;' +
        'background:radial-gradient(circle at 35% 35%,rgba(255,247,237,.9),rgba(' + c + ',.5) 45%,rgba(' + c + ',0) 72%);' +
        '--dx:' + o[6] + 'px;--dy:-' + (mobile ? 260 : 320) + 'px;animation-duration:' + o[4] + 's;animation-delay:' + o[5] + 's"></span>';
    }
    return html;
  }

  // ─── Bầy chim ───
  // 'v': chữ V 5–9 con · 'cluster': đàn lớn 9–15 con bay lộn xộn · 'pair': đôi chim.
  // Bay cả hai chiều; 35% là đàn xa (nhỏ, nhạt, chậm, cao hơn); một số con vỗ cánh rồi lượn.
  var BIRD_SVG = '<svg viewBox="0 0 24 10"><path d="M1 6 Q6 0.5 12 6 Q18 0.5 23 6"/></svg>';

  function spawnFlock(kind) {
    var host = $('skyFrontDay');
    if (!host || host.querySelectorAll('.flock').length > 2) return;
    kind = kind || pick(['v', 'v', 'cluster', 'cluster', 'pair']);
    var mobile = isMobile();
    var rtl = Math.random() < 0.4;
    var far = Math.random() < 0.35;
    var dir = rtl ? 1 : -1; // con đi sau nằm về phía ngược hướng bay

    var flock = document.createElement('div');
    flock.className = 'flock';
    flock.style.top = rand(far ? 5 : 10, far ? 22 : 42).toFixed(1) + '%';
    flock.style.setProperty('--from', rtl ? 'calc(100vw + 60px)' : '-240px');
    flock.style.setProperty('--to', rtl ? '-260px' : 'calc(100vw + 60px)');
    flock.style.setProperty('--rise', rand(-70, 30).toFixed(0) + 'px');
    flock.style.setProperty('--bird', far ? 'rgba(88,72,120,.38)' : 'rgba(64,48,92,.62)');
    flock.style.animationDuration = ((mobile ? rand(13, 18) : rand(22, 32)) * (far ? 1.3 : 1)).toFixed(1) + 's';

    var n = kind === 'pair' ? 2 : (kind === 'cluster' ? 9 + Math.floor(Math.random() * 7) : 5 + Math.floor(Math.random() * 5));
    var html = '';
    for (var i = 0; i < n; i++) {
      var bx, by;
      if (kind === 'v') {
        var row = Math.ceil(i / 2);
        bx = row * 20 * dir + rand(-3, 3);
        by = i === 0 ? 0 : (i % 2 ? -1 : 1) * row * 11;
      } else if (kind === 'cluster') {
        bx = rand(0, 150) * dir;
        by = rand(-34, 34);
      } else {
        bx = i * rand(18, 28) * dir;
        by = i * rand(-10, 10);
      }
      var scale = (far ? 0.62 : 1) * rand(0.7, 1.05);
      var glide = Math.random() < 0.35;
      html += '<span class="flock__bird' + (glide ? ' flock__bird--glide' : '') + '" style="left:' + bx.toFixed(0) + 'px;top:' + by.toFixed(0) +
        'px;width:' + (22 * scale).toFixed(1) + 'px;height:' + (10 * scale).toFixed(1) + 'px;--by:' + rand(3, 9).toFixed(1) +
        'px;animation-duration:' + rand(2, 3.4).toFixed(2) + 's;animation-delay:' + (-rand(0, 3)).toFixed(2) + 's">' +
        BIRD_SVG.replace('<svg', '<svg style="animation-duration:' + (glide ? rand(2, 2.8) : rand(0.3, 0.45)).toFixed(2) +
          's;animation-delay:' + (-rand(0, 2)).toFixed(2) + 's"') + '</span>';
    }
    flock.innerHTML = html;
    flock.addEventListener('animationend', function (e) {
      if (e.target === flock) flock.remove();
    });
    host.appendChild(flock);
  }

  // ============================================================
  // MÁY BAY KÉO BĂNG RÔN
  // ============================================================

  var MSG_DAY = [
    '☀️ Làm việc vui vẻ nha!',
    '🌈 Chúc một ngày thật suôn sẻ',
    '💪 Cố lên, bạn làm được mà!',
    '🎯 Từng giờ nhỏ làm nên tuần lớn',
    '☕ Một tách cà phê rồi chiến tiếp!',
    '🌻 Mỉm cười một cái nào!',
    '🌇 Hoàng hôn đẹp, ngày làm việc cũng đẹp',
    '✨ Ngày mới, năng lượng mới!'
  ];
  var MSG_NIGHT = [
    '🌙 Chúc một buổi tối bình yên',
    '🌠 Thấy sao băng thì ước đi nào!',
    '✨ Hôm nay bạn đã làm rất tốt',
    '⭐ Ước gì được nấy — đủ 44h nhé!',
    '💫 Nghỉ ngơi cũng là một phần công việc',
    '🌃 Thành phố lên đèn, nhớ về sớm nha'
  ];
  var lastMessage = '';

  // Câu theo giờ, theo thứ và theo tiến độ tuần (app.js cho cicoWeekStats)
  function contextMessages() {
    var now = new Date(), h = now.getHours(), d = now.getDay(), out = [];
    if (h >= 5 && h < 10) out.push('🌅 Chào buổi sáng! Ngày mới vui vẻ nhé');
    if (h >= 11 && h < 13) out.push('🍜 Nhớ ăn trưa đầy đủ nha!');
    if (h >= 14 && h < 17) out.push('🍵 Chiều rồi, uống miếng nước nào!');
    if (h >= 17 && h < 19) out.push('🏠 Sắp về rồi, cố thêm chút nữa!');
    if (h >= 22 || h < 4) out.push('🦉 Khuya rồi đó, đi ngủ thôi!');
    if (d === 1) out.push('🚀 Thứ Hai khởi động thật mạnh!');
    if (d === 5) out.push('🎉 Thứ Sáu rồi, cuối tuần tới nơi!');
    if (d === 6) out.push('🌤 Thứ Bảy nhẹ nhàng thôi nhé');
    if (d === 0) out.push('😴 Chủ nhật, nghỉ ngơi thật đã!');
    if (typeof window.cicoWeekStats === 'function') {
      var s = window.cicoWeekStats();
      if (s.done) out.push('🏆 Đủ 44h rồi, tuần này tuyệt vời!');
      else if (s.remaining <= 8 * 60) out.push('🔥 Chỉ còn ' + s.remainingText + ' nữa là cán đích!');
      else out.push('⏱ Còn ' + s.remainingText + ' nữa là đủ 44h, cố lên!');
    }
    return out;
  }

  function pickMessage(theme) {
    var ctx = contextMessages();
    var pool = ctx.length && Math.random() < 0.5 ? ctx : (theme === 'dark' ? MSG_NIGHT : MSG_DAY);
    var choices = pool.filter(function (m) { return m !== lastMessage; });
    lastMessage = pick(choices.length ? choices : pool);
    return lastMessage;
  }

  // Máy bay cánh quạt nhìn ngang, mũi quay phải.
  // Đêm: thân tối, buồng lái sáng đèn, đèn hàng không đỏ/xanh/trắng nhấp nháy, đèn pha rọi trước.
  function planeSvg(night) {
    var body = night ? '#64748b' : '#fffaf5';
    var line = '#94a3b8';
    var accent = night ? '#6366f1' : '#f43f5e';
    var accentDark = night ? '#4338ca' : '#e11d48';
    var wing = night ? '#475569' : '#f1e7e4';
    return '<svg class="plane__craft" viewBox="0 0 72 32">' +
      (night
        ? '<defs><linearGradient id="planeBeam" x1="0" x2="1"><stop offset="0" stop-color="rgba(254,243,199,.5)"/><stop offset="1" stop-color="rgba(254,243,199,0)"/></linearGradient></defs>' +
          '<path d="M64 16.5 L106 8 L106 28 Z" fill="url(#planeBeam)"/>'
        : '') +
      '<path d="M3 16.5 L15 16 L13 19.5 L5 19.5 Z" fill="' + accentDark + '"/>' +
      '<path d="M5 15 L1.5 4 Q2 3 3.5 3 L9 3 L17 13 Z" fill="' + accent + '"/>' +
      '<path d="M4 14.5 Q28 9.5 50 10.5 Q60 11.5 63 16 Q60 20.5 50 21 Q28 22 5 18 Z" fill="' + body + '" stroke="' + line + '" stroke-width="0.6"/>' +
      '<path d="M7 16.6 Q30 15.2 61 16" fill="none" stroke="' + accent + '" stroke-width="1.6"/>' +
      '<path d="M44 12 Q47.5 7.5 54 11.6 Z" fill="' + (night ? '#fde68a' : '#7dd3fc') + '" stroke="' + (night ? '#f59e0b' : '#0369a1') + '" stroke-width="0.5"/>' +
      '<ellipse cx="33" cy="18.6" rx="12" ry="2.3" fill="' + wing + '" stroke="' + line + '" stroke-width="0.5"/>' +
      '<path d="M37 21 L35.5 25 M42 21 L43 25" stroke="#475569" stroke-width="1"/>' +
      '<circle cx="35.5" cy="25.6" r="1.5" fill="#334155"/><circle cx="43" cy="25.6" r="1.5" fill="#334155"/>' +
      '<circle cx="63.2" cy="16" r="1.7" fill="#475569"/>' +
      '<ellipse class="plane__prop" cx="64.8" cy="16" rx="0.9" ry="8" fill="' + (night ? 'rgba(203,213,225,.55)' : 'rgba(71,85,105,.55)') + '"/>' +
      (night
        ? '<g class="plane__beacon"><circle cx="30" cy="10.4" r="3.2" fill="rgba(248,113,113,.35)"/><circle cx="30" cy="10.4" r="1.2" fill="#f87171"/></g>' +
          '<g class="plane__strobe"><circle cx="3" cy="3.2" r="3" fill="rgba(255,255,255,.4)"/><circle cx="3" cy="3.2" r="1.1" fill="#fff"/></g>' +
          '<circle cx="22" cy="18.6" r="0.9" fill="#4ade80"/>'
        : '') +
      '</svg>';
  }

  var ROPE_SVG = '<svg class="plane__rope" viewBox="0 0 36 30" preserveAspectRatio="none"><path d="M0 15 Q18 21 36 14"/></svg>';

  function spawnPlane(theme) {
    var night = theme === 'dark';
    var host = $(night ? 'skyFrontNight' : 'skyFrontDay');
    if (!host || host.querySelector('.plane') || theme !== currentTheme()) return;
    var mobile = isMobile();
    var p = document.createElement('div');
    p.className = 'plane plane--' + (night ? 'night' : 'day');
    p.style.top = rand(mobile ? 9 : 7, mobile ? 30 : 36).toFixed(1) + '%';
    p.style.setProperty('--rise', rand(-50, 20).toFixed(0) + 'px');
    p.style.animationDuration = (mobile ? rand(13, 16) : rand(20, 26)).toFixed(1) + 's';
    p.innerHTML = '<div class="plane__rig"><div class="plane__flag"><span class="plane__banner"></span></div>' + ROPE_SVG + planeSvg(night) + '</div>';
    p.querySelector('.plane__banner').textContent = pickMessage(theme);
    p.addEventListener('animationend', function (e) {
      if (e.target === p) p.remove();
    });
    host.appendChild(p);
  }

  // ============================================================
  // SKY — DỰNG & VÒNG LẶP
  // ============================================================

  function buildSky() {
    var sky = $('sky');
    if (sky) {
      sky.innerHTML =
        '<div class="sky__layer sky__night">' + buildNight() + '</div>' +
        '<div class="sky__layer sky__day">' + buildDay() + '</div>';
    }
    var front = $('skyFront');
    if (front) {
      front.innerHTML =
        '<div class="sky__layer sky__night"><div class="sky-host" id="skyFrontNight"></div></div>' +
        '<div class="sky__layer sky__day"><div class="sky-host" id="skyFrontDay"></div></div>';
    }
  }

  // Lặp fn sau mỗi min–max ms (tab ẩn thì bỏ lượt); máy bật "giảm chuyển động" thì thưa gấp 1,5 lần
  function loop(fn, min, max, first) {
    setTimeout(function tick() {
      if (!document.hidden) fn();
      setTimeout(tick, rand(min, max) * (reduceMotion.matches ? 1.5 : 1));
    }, first);
  }

  function startSkyLoops() {
    // Đêm: sao băng mỗi 0,6–2,2s, 20% là cả chùm; mưa bão mỗi 30–55s; cầu lửa mỗi 15–30s
    loop(function () {
      if (!isDark()) return;
      if (Math.random() < (reduceMotion.matches ? 0.08 : 0.2)) meteorBurst(4 + Math.floor(Math.random() * 4));
      else spawnMeteor();
    }, 600, 2200, 400);
    loop(function () { if (isDark() && !reduceMotion.matches) meteorStorm(); }, 30000, 55000, rand(8000, 14000));
    loop(function () { if (isDark()) spawnFireball(); }, 15000, 30000, rand(5000, 9000));

    // Hoàng hôn: bầy chim mỗi 7–14s
    loop(function () { if (!isDark()) spawnFlock(); }, 7000, 14000, rand(1500, 3000));

    // Máy bay kéo băng rôn: lượt đầu sau 3–6s, rồi mỗi 40–70s
    loop(function () { spawnPlane(currentTheme()); }, 40000, 70000, rand(3000, 6000));
  }

  // Đổi qua lại mobile/desktop, hoặc màn rộng hơn lúc vẽ thành phố → dựng lại
  function watchResize() {
    var wasMobile = isMobile();
    var timer = null;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (isMobile() === wasMobile && window.innerWidth <= builtWidth) return;
        wasMobile = isMobile();
        buildSky();
      }, 250);
    });
  }

  // ============================================================
  // INIT
  // ============================================================

  function init() {
    setupToggle();
    buildSky();
    startSkyLoops();
    watchResize();

    window.cicoSky = {
      plane: function () { spawnPlane(currentTheme()); },
      flock: spawnFlock,
      meteors: meteorBurst,
      storm: meteorStorm,
      fireball: spawnFireball
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
