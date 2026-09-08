/* Eventually — event time zones.
 *
 * THE BUG THIS EXISTS TO FIX
 * An organiser in Saskatchewan published a 7:00 p.m. event in Abuja. The form
 * did `new Date('2026-09-07T19:00:00')`, which JavaScript interprets in the
 * BROWSER's zone — so it stored 01:00 UTC, i.e. 2 a.m. in Abuja. The event page
 * then rendered that instant in each VIEWER's zone, so nobody anywhere saw the
 * time the organiser meant. Registration also closed early, because the server
 * correctly judged an event that had "already started".
 *
 * The rule now: an event happens at a wall-clock time IN A PLACE. We store the
 * true UTC instant (so sorting, "live now", and the registration window all stay
 * correct) plus the IANA zone it was entered in (so we can always show the time
 * the organiser actually meant, to a reader anywhere in the world).
 *
 * No library and no external service: Intl already knows every IANA zone. The
 * only thing it won't do is turn coordinates into a zone name, so the country
 * table below supplies a DEFAULT and the organiser confirms it on screen.
 */
(function (global) {
  'use strict';

  const LOCAL = (function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch (e) { return 'UTC'; }
  })();

  function valid(zone) {
    if (!zone) return false;
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; }
    catch (e) { return false; }
  }

  // Break an instant into its wall-clock parts AS SEEN IN `zone`.
  const partsCache = {};
  function fmtFor(zone) {
    if (!partsCache[zone]) {
      partsCache[zone] = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    return partsCache[zone];
  }
  function wallPartsOf(date, zone) {
    const p = {};
    fmtFor(zone).formatToParts(date).forEach(function (x) { if (x.type !== 'literal') p[x.type] = x.value; });
    // 'en-GB' renders midnight as 24 rather than 00 in some engines.
    let h = +p.hour; if (h === 24) h = 0;
    return { y: +p.year, mo: +p.month, d: +p.day, h: h, mi: +p.minute, s: +p.second };
  }

  // How far `zone` is from UTC at a given instant, in milliseconds.
  function offsetAt(date, zone) {
    const w = wallPartsOf(date, zone);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - (date.getTime() - date.getMilliseconds());
  }

  /* Wall-clock time in `zone` -> the true UTC instant.
   *
   * Two passes, because the offset depends on the very instant we're solving
   * for: the first guess lands close, the second corrects it when the guess fell
   * on the far side of a daylight-saving change. */
  function fromWallClock(y, mo, d, h, mi, zone) {
    if (!valid(zone)) zone = LOCAL;
    const target = Date.UTC(y, mo - 1, d, h, mi, 0);
    let guess = target;
    for (let i = 0; i < 2; i++) guess = target - offsetAt(new Date(guess), zone);
    return new Date(guess);
  }

  // The reverse: what wall clock does this instant show in `zone`?
  function toWallClock(date, zone) {
    return wallPartsOf(date, valid(zone) ? zone : LOCAL);
  }

  function fmt(date, zone, opts) {
    const o = Object.assign({ timeZone: valid(zone) ? zone : LOCAL }, opts || {});
    try { return new Intl.DateTimeFormat(undefined, o).format(date); }
    catch (e) { return new Intl.DateTimeFormat(undefined, opts || {}).format(date); }
  }

  // "WAT", "GMT+1" — whatever the platform has for this zone at this instant.
  function abbr(date, zone) {
    if (!valid(zone)) return '';
    try {
      const p = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'short' }).formatToParts(date);
      const t = p.find(function (x) { return x.type === 'timeZoneName'; });
      return t ? t.value : '';
    } catch (e) { return ''; }
  }

  // Does this zone show the same wall clock as the reader's own? If so there is
  // nothing to disambiguate and we can keep the UI quiet.
  function sameAsLocal(date, zone) {
    if (!valid(zone) || zone === LOCAL) return true;
    return offsetAt(date, zone) === offsetAt(date, LOCAL);
  }

  /* Country -> default zone.
   *
   * Only single-zone countries are listed. A country that spans several zones is
   * deliberately absent: guessing "America/New_York" for anywhere in the US is
   * worse than admitting we don't know, because a wrong guess that LOOKS
   * confident is exactly how the original bug survived. Those fall through to
   * MULTI below, which offers that country's zones and asks. */
  const BY_COUNTRY = {
    ng: 'Africa/Lagos', gh: 'Africa/Accra', ke: 'Africa/Nairobi', za: 'Africa/Johannesburg',
    eg: 'Africa/Cairo', ma: 'Africa/Casablanca', tz: 'Africa/Dar_es_Salaam', ug: 'Africa/Kampala',
    et: 'Africa/Addis_Ababa', sn: 'Africa/Dakar', ci: 'Africa/Abidjan', cm: 'Africa/Douala',
    zw: 'Africa/Harare', zm: 'Africa/Lusaka', rw: 'Africa/Kigali', bw: 'Africa/Gaborone',
    mz: 'Africa/Maputo', ao: 'Africa/Luanda', tn: 'Africa/Tunis', dz: 'Africa/Algiers',
    ly: 'Africa/Tripoli', sd: 'Africa/Khartoum', ml: 'Africa/Bamako', bf: 'Africa/Ouagadougou',
    ne: 'Africa/Niamey', td: 'Africa/Ndjamena', so: 'Africa/Mogadishu', mw: 'Africa/Blantyre',
    mu: 'Indian/Mauritius', mg: 'Indian/Antananarivo',
    gb: 'Europe/London', ie: 'Europe/Dublin', fr: 'Europe/Paris', de: 'Europe/Berlin',
    it: 'Europe/Rome', nl: 'Europe/Amsterdam', be: 'Europe/Brussels', ch: 'Europe/Zurich',
    at: 'Europe/Vienna', se: 'Europe/Stockholm', no: 'Europe/Oslo', dk: 'Europe/Copenhagen',
    fi: 'Europe/Helsinki', pl: 'Europe/Warsaw', cz: 'Europe/Prague', sk: 'Europe/Bratislava',
    hu: 'Europe/Budapest', ro: 'Europe/Bucharest', bg: 'Europe/Sofia', gr: 'Europe/Athens',
    hr: 'Europe/Zagreb', si: 'Europe/Ljubljana', rs: 'Europe/Belgrade', ba: 'Europe/Sarajevo',
    al: 'Europe/Tirane', mk: 'Europe/Skopje', me: 'Europe/Podgorica', lt: 'Europe/Vilnius',
    lv: 'Europe/Riga', ee: 'Europe/Tallinn', by: 'Europe/Minsk', md: 'Europe/Chisinau',
    is: 'Atlantic/Reykjavik', lu: 'Europe/Luxembourg', mt: 'Europe/Malta', cy: 'Asia/Nicosia',
    tr: 'Europe/Istanbul', ua: 'Europe/Kyiv',
    jp: 'Asia/Tokyo', kr: 'Asia/Seoul', cn: 'Asia/Shanghai', hk: 'Asia/Hong_Kong',
    tw: 'Asia/Taipei', sg: 'Asia/Singapore', my: 'Asia/Kuala_Lumpur', th: 'Asia/Bangkok',
    vn: 'Asia/Ho_Chi_Minh', ph: 'Asia/Manila', in: 'Asia/Kolkata', pk: 'Asia/Karachi',
    bd: 'Asia/Dhaka', lk: 'Asia/Colombo', np: 'Asia/Kathmandu', mm: 'Asia/Yangon',
    kh: 'Asia/Phnom_Penh', la: 'Asia/Vientiane', ae: 'Asia/Dubai', sa: 'Asia/Riyadh',
    qa: 'Asia/Qatar', kw: 'Asia/Kuwait', bh: 'Asia/Bahrain', om: 'Asia/Muscat',
    jo: 'Asia/Amman', lb: 'Asia/Beirut', il: 'Asia/Jerusalem', iq: 'Asia/Baghdad',
    ir: 'Asia/Tehran', af: 'Asia/Kabul', uz: 'Asia/Tashkent', ge: 'Asia/Tbilisi',
    am: 'Asia/Yerevan', az: 'Asia/Baku',
    ar: 'America/Argentina/Buenos_Aires', pe: 'America/Lima', co: 'America/Bogota',
    ve: 'America/Caracas', uy: 'America/Montevideo', py: 'America/Asuncion',
    bo: 'America/La_Paz', cr: 'America/Costa_Rica', pa: 'America/Panama',
    gt: 'America/Guatemala', hn: 'America/Tegucigalpa', ni: 'America/Managua',
    sv: 'America/El_Salvador', cu: 'America/Havana', do: 'America/Santo_Domingo',
    jm: 'America/Jamaica', tt: 'America/Port_of_Spain', bs: 'America/Nassau',
    bb: 'America/Barbados', ht: 'America/Port-au-Prince', pr: 'America/Puerto_Rico',
    nz: 'Pacific/Auckland', fj: 'Pacific/Fiji', pg: 'Pacific/Port_Moresby'
  };

  /* Countries that span zones. We offer the country's zones rather than picking
     one. Ordered so the most populous is first, which is the least-bad default
     when the organiser doesn't touch it. */
  const MULTI = {
    us: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
         'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'],
    ca: ['America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg',
         'America/Regina', 'America/Halifax', 'America/St_Johns'],
    au: ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth',
         'Australia/Adelaide', 'Australia/Darwin', 'Australia/Hobart'],
    br: ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Rio_Branco'],
    mx: ['America/Mexico_City', 'America/Monterrey', 'America/Chihuahua', 'America/Tijuana',
         'America/Cancun'],
    ru: ['Europe/Moscow', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk',
         'Asia/Irkutsk', 'Asia/Vladivostok', 'Europe/Kaliningrad'],
    id: ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'],
    cl: ['America/Santiago', 'Pacific/Easter'],
    ec: ['America/Guayaquil', 'Pacific/Galapagos'],
    es: ['Europe/Madrid', 'Atlantic/Canary'],
    pt: ['Europe/Lisbon', 'Atlantic/Azores'],
    kz: ['Asia/Almaty', 'Asia/Aqtobe'],
    cd: ['Africa/Kinshasa', 'Africa/Lubumbashi'],
    mn: ['Asia/Ulaanbaatar', 'Asia/Hovd']
  };

  /* Best guess for a place, and how much we trust it. `sure:false` is a signal to
     the UI to draw attention rather than let a default slip through unread. */
  function guess(countryCode) {
    const cc = String(countryCode || '').toLowerCase();
    if (BY_COUNTRY[cc]) return { zone: BY_COUNTRY[cc], sure: true, options: null };
    if (MULTI[cc]) {
      // If the organiser's own zone is one of that country's, they're most likely
      // publishing at home — a far better default than the largest city.
      const opts = MULTI[cc];
      const mine = opts.indexOf(LOCAL) !== -1 ? LOCAL : opts[0];
      return { zone: mine, sure: opts.indexOf(LOCAL) !== -1, options: opts };
    }
    return { zone: LOCAL, sure: false, options: null };
  }

  // Every zone the platform knows, for the "somewhere else" case.
  function allZones() {
    try {
      if (Intl.supportedValuesOf) return Intl.supportedValuesOf('timeZone');
    } catch (e) { /* older engine */ }
    const seen = {}, out = [];
    Object.keys(BY_COUNTRY).forEach(function (k) { seen[BY_COUNTRY[k]] = 1; });
    Object.keys(MULTI).forEach(function (k) { MULTI[k].forEach(function (z) { seen[z] = 1; }); });
    Object.keys(seen).forEach(function (z) { out.push(z); });
    out.push('UTC');
    return out.sort();
  }

  function label(zone) { return String(zone || '').replace(/_/g, ' ').replace('/', ' / '); }

  global.EventuallyTZ = {
    local: LOCAL,
    valid: valid,
    guess: guess,
    allZones: allZones,
    label: label,
    abbr: abbr,
    fromWallClock: fromWallClock,
    toWallClock: toWallClock,
    format: fmt,
    sameAsLocal: sameAsLocal,
    offsetAt: offsetAt
  };
})(window);
