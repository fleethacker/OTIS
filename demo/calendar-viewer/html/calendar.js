(function () {
  'use strict';

  var CALENDAR_URL = '/dav/sailor/otis/';
  var POLL_MS = 3000;
  var HIGHLIGHT_MS = 6000;
  var HOUR_PX = 56;
  var DAY_MS = 86400000;
  var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var state = {
    events: [],
    known: null,          // Set of event keys seen so far; null until the first successful poll
    highlightUntil: {},   // event key -> epoch ms
    weekStart: null,      // epoch ms of Monday 00:00 UTC
    userNavigated: false,
    signature: '',
    status: 'loading'     // loading | ok | missing | error
  };

  var el = {
    grid: document.getElementById('grid'),
    scroller: document.getElementById('scroller'),
    range: document.getElementById('range'),
    count: document.getElementById('count'),
    poll: document.getElementById('poll'),
    notice: document.getElementById('notice')
  };

  // ---------- iCalendar parsing ----------

  function unfold(text) {
    return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  }

  function unescapeText(s) {
    return s.replace(/\\([\;,nN])/g, function (_, c) {
      return (c === 'n' || c === 'N') ? '\n' : c;
    });
  }

  // Split on commas that are not backslash-escaped.
  function splitList(s) {
    var out = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; }
      else if (s[i] === ',') { out.push(cur); cur = ''; }
      else { cur += s[i]; }
    }
    out.push(cur);
    return out;
  }

  // Returns {ms, dateOnly} or null. UTC "...Z", DATE (YYYYMMDD), and
  // floating/TZID date-times (treated as UTC; the demo writes UTC only).
  function parseWhen(value, params) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value.trim());
    if (!m) return null;
    var dateOnly = m[4] === undefined || /VALUE=DATE(?!-)/i.test(params || '');
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return { ms: ms, dateOnly: dateOnly && m[4] === undefined };
  }

  function parseCalendar(text) {
    var events = [];
    var cur = null;
    unfold(text).forEach(function (line) {
      if (line === 'BEGIN:VEVENT') { cur = { cats: [] }; return; }
      if (line === 'END:VEVENT') {
        if (cur && cur.start) {
          var s = cur.start;
          var e = cur.end;
          var endMs;
          if (e && e.ms > s.ms) endMs = e.ms;
          else endMs = s.ms + (s.dateOnly ? DAY_MS : 30 * 60000);
          events.push({
            key: cur.uid || (s.ms + '|' + (cur.summary || '')),
            summary: cur.summary || '(no title)',
            cats: cur.cats,
            start: s.ms,
            end: endMs,
            allDay: s.dateOnly
          });
        }
        cur = null;
        return;
      }
      if (!cur) return;
      var colon = line.indexOf(':');
      if (colon < 0) return;
      var head = line.slice(0, colon);
      var value = line.slice(colon + 1);
      var semi = head.indexOf(';');
      var name = (semi < 0 ? head : head.slice(0, semi)).toUpperCase();
      var params = semi < 0 ? '' : head.slice(semi + 1);
      if (name === 'UID') cur.uid = value;
      else if (name === 'SUMMARY') cur.summary = unescapeText(value);
      else if (name === 'DTSTART') cur.start = parseWhen(value, params);
      else if (name === 'DTEND') cur.end = parseWhen(value, params);
      else if (name === 'CATEGORIES') {
        splitList(value).forEach(function (c) {
          c = unescapeText(c).trim();
          if (c) cur.cats.push(c);
        });
      }
    });
    events.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return events;
  }

  // ---------- time helpers (all UTC) ----------

  function weekStartOf(ms) {
    var d = new Date(ms);
    var day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return day - ((d.getUTCDay() + 6) % 7) * DAY_MS;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(ms) { var d = new Date(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function dayLabel(ms) { var d = new Date(ms); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
  function fullDay(ms) { return dayLabel(ms) + ' ' + new Date(ms).getUTCFullYear(); }

  function latestEvent(events) {
    var best = null;
    events.forEach(function (e) { if (!best || e.start >= best.start) best = e; });
    return best;
  }

  // ---------- rendering ----------

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // Assign side-by-side lanes to overlapping segments within one day.
  function layoutLanes(segs) {
    segs.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var cluster = [], clusterEnd = -1;
    function flush() {
      var laneEnds = [];
      cluster.forEach(function (g) {
        var lane = 0;
        while (lane < laneEnds.length && laneEnds[lane] > g.s) lane++;
        laneEnds[lane] = g.e;
        g.lane = lane;
      });
      cluster.forEach(function (g) { g.lanes = laneEnds.length; });
      cluster = [];
    }
    segs.forEach(function (g) {
      if (cluster.length && g.s >= clusterEnd) { flush(); clusterEnd = -1; }
      cluster.push(g);
      clusterEnd = Math.max(clusterEnd, g.e);
    });
    if (cluster.length) flush();
  }

  function eventBlock(ev, now) {
    var b = node('div', 'event');
    if (state.highlightUntil[ev.key] && state.highlightUntil[ev.key] > now) b.classList.add('new');
    b.title = ev.summary + '\n' + (ev.allDay ? 'All day' : fullDay(ev.start) + ' ' + hhmm(ev.start) + '-' + hhmm(ev.end) + ' UTC') +
      (ev.cats.length ? '\n' + ev.cats.join(', ') : '');
    b.appendChild(node('div', 'summary', ev.summary));
    var meta = [];
    if (!ev.allDay) meta.push(hhmm(ev.start) + '-' + hhmm(ev.end));
    if (ev.cats.length) meta.push(ev.cats.join(', '));
    if (meta.length) b.appendChild(node('div', 'meta', meta.join(' \u00b7 ')));
    return b;
  }

  function render() {
    var now = Date.now();
    var ws = state.weekStart;
    var g = el.grid;
    while (g.firstChild) g.removeChild(g.firstChild);

    var i;

    // Header row
    g.appendChild(node('div', 'corner'));
    for (i = 0; i < 7; i++) {
      var dms = ws + i * DAY_MS;
      var dh = node('div', 'dayhead', DAY_NAMES[i]);
      dh.appendChild(node('small', null, dayLabel(dms)));
      if (new Date(dms).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10)) dh.classList.add('today');
      g.appendChild(dh);
    }

    // All-day row
    g.appendChild(node('div', 'allday-label', 'all day'));
    var alldayCells = [];
    for (i = 0; i < 7; i++) { var c = node('div', 'allday-cell'); alldayCells.push(c); g.appendChild(c); }

    // Hour labels + day columns
    var hours = node('div', 'hours');
    for (i = 1; i < 24; i++) {
      var hs = node('span', null, pad(i) + ':00');
      hs.style.top = (i * HOUR_PX) + 'px';
      hours.appendChild(hs);
    }
    g.appendChild(hours);
    var cols = [];
    for (i = 0; i < 7; i++) { var col = node('div', 'daycol'); cols.push(col); g.appendChild(col); }

    // Place events
    var weekEvents = 0;
    var perDay = [[], [], [], [], [], [], []];
    state.events.forEach(function (ev) {
      var inWeek = false;
      for (var d = 0; d < 7; d++) {
        var ds = ws + d * DAY_MS, de = ds + DAY_MS;
        if (ev.start < de && ev.end > ds) {
          inWeek = true;
          if (ev.allDay) alldayCells[d].appendChild(eventBlock(ev, now));
          else perDay[d].push({ ev: ev, s: Math.max(ev.start, ds) - ds, e: Math.min(ev.end, de) - ds });
        }
      }
      if (inWeek) weekEvents++;
    });
    alldayCells.forEach(function (cell) {
      Array.prototype.forEach.call(cell.children, function (ch) { ch.classList.add('allday'); });
    });
    perDay.forEach(function (segs, d) {
      layoutLanes(segs);
      segs.forEach(function (sg) {
        var b = eventBlock(sg.ev, now);
        var top = sg.s / 3600000 * HOUR_PX;
        var h = Math.max((sg.e - sg.s) / 3600000 * HOUR_PX, 22);
        b.style.top = top + 'px';
        b.style.height = (h - 1) + 'px';
        b.style.left = (sg.lane / sg.lanes * 100) + '%';
        b.style.width = 'calc(' + (100 / sg.lanes) + '% - 2px)';
        cols[d].appendChild(b);
      });
    });

    el.range.textContent = dayLabel(ws) + ' – ' + fullDay(ws + 6 * DAY_MS) + ' (UTC)';
    var total = state.events.length;
    el.count.textContent = total + (total === 1 ? ' event' : ' events') + ' · ' + weekEvents + ' this week';
  }

  function scrollToWeekContent() {
    var first = null;
    var ws = state.weekStart;
    state.events.forEach(function (ev) {
      if (ev.allDay || ev.end <= ws || ev.start >= ws + 7 * DAY_MS) return;
      var tod = ((Math.max(ev.start, ws) - ws) % DAY_MS) / 3600000;
      if (first === null || tod < first) first = tod;
    });
    var target = (first === null ? 7 : Math.max(first - 0.75, 0)) * HOUR_PX;
    el.scroller.scrollTop = target;
  }

  function setNotice(msg, isError) {
    if (!msg) { el.notice.hidden = true; return; }
    el.notice.hidden = false;
    el.notice.textContent = msg;
    el.notice.className = 'notice' + (isError ? ' error' : '');
  }

  // ---------- polling ----------

  function applyEvents(events) {
    var now = Date.now();
    var keys = {};
    events.forEach(function (e) { keys[e.key] = true; });

    if (state.known) {
      events.forEach(function (e) {
        if (!state.known[e.key]) state.highlightUntil[e.key] = now + HIGHLIGHT_MS;
      });
    }
    state.known = keys;

    var sig = JSON.stringify(events.map(function (e) { return [e.key, e.summary, e.start, e.end, e.cats]; }));
    var changed = sig !== state.signature;
    state.signature = sig;
    state.events = events;

    // Follow the most recent event until the user navigates by hand.
    var prevWeek = state.weekStart;
    if (!state.userNavigated) {
      var latest = latestEvent(events);
      state.weekStart = weekStartOf(latest ? latest.start : now);
    }
    var weekChanged = prevWeek !== state.weekStart;
    if (changed || weekChanged || state.status !== 'ok') {
      render();
      if (weekChanged) scrollToWeekContent();
    }
    state.status = 'ok';
    scheduleHighlightExpiry();
  }

  var expiryTimer = null;
  function scheduleHighlightExpiry() {
    clearTimeout(expiryTimer);
    var now = Date.now(), next = null;
    Object.keys(state.highlightUntil).forEach(function (k) {
      var t = state.highlightUntil[k];
      if (t > now && (next === null || t < next)) next = t;
    });
    if (next !== null) expiryTimer = setTimeout(render, next - now + 50);
  }

  function showEmpty(noticeText, isError, status) {
    state.events = [];
    state.signature = '';
    if (!state.userNavigated) state.weekStart = weekStartOf(Date.now());
    state.status = status;
    render();
    setNotice(noticeText, isError);
  }

  function poll() {
    var started = new Date();
    fetch(CALENDAR_URL, { cache: 'no-store', headers: { Accept: 'text/calendar' } })
      .then(function (res) {
        if (res.status === 404) {
          // The calendar does not exist yet; any events we knew are gone.
          state.known = {};
          showEmpty('No calendar yet — click Sync to Outlook in OTIS', false, 'missing');
          return null;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        if (text === null) return;
        setNotice(null);
        applyEvents(parseCalendar(text));
      })
      .catch(function (err) {
        setNotice('Cannot read the calendar (' + err.message + '). Retrying.', true);
      })
      .then(function () {
        el.poll.textContent = 'Last polled ' + hhmm(started.getTime()) + ':' + pad(started.getUTCSeconds()) + 'Z';
        setTimeout(poll, POLL_MS);
      });
  }

  // ---------- controls ----------

  function shiftWeek(n) {
    state.userNavigated = true;
    state.weekStart += n * 7 * DAY_MS;
    render();
    scrollToWeekContent();
  }
  document.getElementById('prev').addEventListener('click', function () { shiftWeek(-1); });
  document.getElementById('next').addEventListener('click', function () { shiftWeek(1); });
  document.getElementById('latest').addEventListener('click', function () {
    state.userNavigated = false;
    var latest = latestEvent(state.events);
    state.weekStart = weekStartOf(latest ? latest.start : Date.now());
    render();
    scrollToWeekContent();
  });

  state.weekStart = weekStartOf(Date.now());
  render();
  scrollToWeekContent();
  poll();
})();
