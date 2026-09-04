/* Eventually — Host localization layer (interim, browser voices).
 * The narrator emits STRUCTURED lines ({kind, data}); this renders them per
 * language. Proper nouns (event/city/region/sponsor) stay original. This is the
 * exact seam the ElevenLabs backend will plug into later (per-language scripts).
 * Default language is English; users opt into others. Translations are interim
 * quality and should get a native review before production. */
(function (global) {
  'use strict';

  const LANGS = [
    { code: 'en', label: 'English',  bcp: 'en-US', rtl: false },
    { code: 'es', label: 'Español',  bcp: 'es-ES', rtl: false, soon: true },
    { code: 'fr', label: 'Français', bcp: 'fr-FR', rtl: false, soon: true },
    { code: 'de', label: 'Deutsch',  bcp: 'de-DE', rtl: false, soon: true },
    { code: 'tr', label: 'Türkçe',   bcp: 'tr-TR', rtl: false, soon: true },
    { code: 'pl', label: 'Polski',   bcp: 'pl-PL', rtl: false, soon: true }
  ];
  const LOCALE = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', tr: 'tr-TR', pl: 'pl-PL', ar: 'ar-EG', zh: 'zh-CN' };
  const DEFAULT_NAME = { en: 'there', es: 'amigo', fr: 'cher visiteur', de: 'zusammen', tr: 'arkadaşlar', pl: 'przyjacielu', ar: 'صديقي', zh: '朋友' };
  const CAT = {
    en: { 'Music': 'music', 'Tech': 'tech', 'Business': 'business', 'Arts': 'arts', 'Food & Drink': 'food & drink', 'Sports': 'sports', 'Film & Media': 'film & media', 'Community': 'community', 'Nightlife': 'nightlife', 'Comedy': 'comedy' },
    es: { 'Music': 'música', 'Tech': 'tecnología', 'Business': 'negocios', 'Arts': 'arte', 'Food & Drink': 'gastronomía', 'Sports': 'deportes', 'Film & Media': 'cine y medios', 'Community': 'comunidad', 'Nightlife': 'vida nocturna', 'Comedy': 'comedia' },
    fr: { 'Music': 'musique', 'Tech': 'tech', 'Business': 'affaires', 'Arts': 'art', 'Food & Drink': 'gastronomie', 'Sports': 'sport', 'Film & Media': 'cinéma et médias', 'Community': 'communauté', 'Nightlife': 'vie nocturne', 'Comedy': 'comédie' },
    de: { 'Music': 'Musik', 'Tech': 'Technik', 'Business': 'Business', 'Arts': 'Kunst', 'Food & Drink': 'Essen & Trinken', 'Sports': 'Sport', 'Film & Media': 'Film & Medien', 'Community': 'Community', 'Nightlife': 'Nachtleben', 'Comedy': 'Comedy' },
    tr: { 'Music': 'müzik', 'Tech': 'teknoloji', 'Business': 'iş dünyası', 'Arts': 'sanat', 'Food & Drink': 'yeme içme', 'Sports': 'spor', 'Film & Media': 'film ve medya', 'Community': 'topluluk', 'Nightlife': 'gece hayatı', 'Comedy': 'komedi' },
    pl: { 'Music': 'muzyka', 'Tech': 'technologia', 'Business': 'biznes', 'Arts': 'sztuka', 'Food & Drink': 'jedzenie i picie', 'Sports': 'sport', 'Film & Media': 'film i media', 'Community': 'społeczność', 'Nightlife': 'życie nocne', 'Comedy': 'komedia' },
    ar: { 'Music': 'موسيقى', 'Tech': 'تقنية', 'Business': 'أعمال', 'Arts': 'فنون', 'Food & Drink': 'طعام وشراب', 'Sports': 'رياضة', 'Film & Media': 'أفلام وإعلام', 'Community': 'مجتمع', 'Nightlife': 'حياة ليلية', 'Comedy': 'كوميديا' },
    zh: { 'Music': '音乐', 'Tech': '科技', 'Business': '商业', 'Arts': '艺术', 'Food & Drink': '美食', 'Sports': '体育', 'Film & Media': '影视', 'Community': '社区', 'Nightlife': '夜生活', 'Comedy': '喜剧' }
  };
  const GREET = {
    en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
    es: { morning: 'Buenos días', afternoon: 'Buenas tardes', evening: 'Buenas noches' },
    fr: { morning: 'Bonjour', afternoon: 'Bon après-midi', evening: 'Bonsoir' },
    de: { morning: 'Guten Morgen', afternoon: 'Guten Tag', evening: 'Guten Abend' },
    tr: { morning: 'Günaydın', afternoon: 'İyi günler', evening: 'İyi akşamlar' },
    pl: { morning: 'Dzień dobry', afternoon: 'Dzień dobry', evening: 'Dobry wieczór' },
    ar: { morning: 'صباح الخير', afternoon: 'مساء الخير', evening: 'مساء الخير' },
    zh: { morning: '早上好', afternoon: '下午好', evening: '晚上好' }
  };
  function n(v, code) { try { return Number(v).toLocaleString(LOCALE[code] || 'en-US'); } catch (e) { return '' + v; } }
  function c(code, k) { return (CAT[code] && CAT[code][k]) || k; }
  function nm(d, code) { return d.name || DEFAULT_NAME[code]; }

  const T = {
    en: {
      welcome: d => `Welcome to Eventually! Right now, there are ${n(d.count, 'en')} events happening live around the world.`,
      greeting: d => !d.hasRecs
        ? `${GREET.en[d.part]}, ${nm(d, 'en')}! Set your location and a few interests, and I'll line up events made just for you.`
        : d.exploring
          ? `${GREET.en[d.part]}! You're exploring ${d.city}. There are ${d.k} ${c('en', d.cat)} events on here right now — including ${d.event}.`
          : `${GREET.en[d.part]}, ${nm(d, 'en')}! Based on what you love, I've found ${d.k} live ${c('en', d.cat)} events within ${d.mi} miles — including ${d.event}, over in ${d.city}.`,
      ident: d => `Now taking you to ${d.city} — here's what's happening there right now.`,
      spotlight: d => `Here's one to watch: ${d.event}, in ${d.city}. ${n(d.going, 'en')} people are heading there right now.`,
      countdown: d => `Heads up — ${d.event} in ${d.city} kicks off in just ${d.min} minutes.`,
      region: d => `Over in ${d.region}, ${d.n} big ${c('en', d.cat)} events are underway right now.`,
      trending: d => `Trending tonight: ${d.event}, in ${d.city}. It's climbing fast, with ${n(d.likes, 'en')} likes.`,
      sponsor: d => d.text || `This update is brought to you by ${d.sponsor}.`,
      tip: () => `Tap any glowing marker on the globe, and you'll see everything happening there.`
    },
    es: {
      welcome: d => `Bienvenido a Eventually. Ahora mismo hay ${n(d.count, 'es')} eventos en directo en todo el mundo.`,
      greeting: d => !d.hasRecs
        ? `${GREET.es[d.part]}, ${nm(d, 'es')}. Configura tu ubicación e intereses y te prepararé eventos a tu medida.`
        : d.exploring
          ? `${GREET.es[d.part]}. Estás explorando ${d.city}. Ahora mismo hay ${d.k} eventos de ${c('es', d.cat)} aquí, incluido ${d.event}.`
          : `${GREET.es[d.part]}, ${nm(d, 'es')}. Según tus intereses, encontré ${d.k} eventos de ${c('es', d.cat)} en directo a menos de ${d.mi} millas, incluido ${d.event} en ${d.city}.`,
      ident: d => `Ahora te llevamos a ${d.city}: esto es lo que está pasando allí.`,
      spotlight: d => `Ponemos el foco en ${d.event} en ${d.city}: ${n(d.going, 'es')} personas asistirán.`,
      countdown: d => `${d.event} comienza en ${d.min} minutos en ${d.city}.`,
      region: d => `Hay ${d.n} grandes eventos de ${c('es', d.cat)} en curso en ${d.region}.`,
      trending: d => `Tendencia ahora: ${d.event} en ${d.city}, con ${n(d.likes, 'es')} me gusta.`,
      sponsor: d => d.text || `Esta actualización es presentada por ${d.sponsor}.`,
      tip: () => `Toca cualquier punto brillante para ver todo lo que ocurre allí.`
    },
    fr: {
      welcome: d => `Bienvenue sur Eventually. Il y a actuellement ${n(d.count, 'fr')} événements en direct dans le monde.`,
      greeting: d => !d.hasRecs
        ? `${GREET.fr[d.part]}, ${nm(d, 'fr')}. Indiquez votre position et vos centres d'intérêt, et je vous proposerai des événements sur mesure.`
        : d.exploring
          ? `${GREET.fr[d.part]} ! Vous explorez ${d.city}. Il y a ${d.k} événements ${c('fr', d.cat)} ici en ce moment, dont ${d.event}.`
          : `${GREET.fr[d.part]}, ${nm(d, 'fr')}. D'après vos centres d'intérêt, j'ai trouvé ${d.k} événements ${c('fr', d.cat)} en direct à moins de ${d.mi} miles, dont ${d.event} à ${d.city}.`,
      ident: d => `Direction ${d.city} — voici ce qui s'y passe en ce moment.`,
      spotlight: d => `Coup de projecteur sur ${d.event} à ${d.city} — ${n(d.going, 'fr')} personnes y vont en ce moment.`,
      countdown: d => `${d.event} commence dans ${d.min} minutes à ${d.city}.`,
      region: d => `${d.n} grands événements ${c('fr', d.cat)} sont en cours en ${d.region}.`,
      trending: d => `Tendance en ce moment : ${d.event} à ${d.city}, avec ${n(d.likes, 'fr')} mentions j'aime.`,
      sponsor: d => d.text || `Cette mise à jour vous est présentée par ${d.sponsor}.`,
      tip: () => `Touchez un point lumineux pour voir tout ce qui s'y passe.`
    },
    de: {
      welcome: d => `Willkommen bei Eventually! Gerade laufen weltweit ${n(d.count, 'de')} Veranstaltungen.`,
      greeting: d => !d.hasRecs
        ? `${GREET.de[d.part]}, ${nm(d, 'de')}! Stell deinen Ort und ein paar Interessen ein, dann suche ich passende Events für dich heraus.`
        : d.exploring
          ? `${GREET.de[d.part]}! Du schaust dir gerade ${d.city} an. Hier laufen ${d.k} ${c('de', d.cat)}-Events — darunter ${d.event}.`
          : `${GREET.de[d.part]}, ${nm(d, 'de')}! Passend zu deinen Interessen habe ich ${d.k} ${c('de', d.cat)}-Events im Umkreis von ${d.mi} Meilen gefunden — darunter ${d.event} in ${d.city}.`,
      ident: d => `Weiter geht's nach ${d.city} — das ist dort gerade los.`,
      spotlight: d => `Eine Empfehlung: ${d.event} in ${d.city}. ${n(d.going, 'de')} Leute sind dabei.`,
      countdown: d => `Achtung — ${d.event} in ${d.city} startet in ${d.min} Minuten.`,
      region: d => `In ${d.region} laufen gerade ${d.n} große ${c('de', d.cat)}-Events.`,
      trending: d => `Heute im Trend: ${d.event} in ${d.city} — mit ${n(d.likes, 'de')} Likes.`,
      sponsor: d => d.text || `Diese Sendung wird präsentiert von ${d.sponsor}.`,
      tip: () => `Tippe auf einen leuchtenden Punkt auf dem Globus und du siehst alles, was dort passiert.`
    },
    tr: {
      welcome: d => `Eventually'ye hoş geldin! Şu anda dünya genelinde ${n(d.count, 'tr')} etkinlik var.`,
      greeting: d => !d.hasRecs
        ? `${GREET.tr[d.part]}, ${nm(d, 'tr')}! Konumunu ve birkaç ilgi alanını seç, sana göre etkinlikleri sıralayayım.`
        : d.exploring
          ? `${GREET.tr[d.part]}! Şu an ${d.city} şehrine bakıyorsun. Burada ${d.k} ${c('tr', d.cat)} etkinliği var — ${d.event} dahil.`
          : `${GREET.tr[d.part]}, ${nm(d, 'tr')}! İlgi alanlarına göre ${d.mi} mil içinde ${d.k} ${c('tr', d.cat)} etkinliği buldum — ${d.city} şehrindeki ${d.event} dahil.`,
      ident: d => `Şimdi ${d.city} şehrine geçiyoruz — orada olup bitenler şöyle.`,
      spotlight: d => `Şuna bir bak: ${d.city} şehrinde ${d.event}. ${n(d.going, 'tr')} kişi katılıyor.`,
      countdown: d => `Dikkat — ${d.city} şehrindeki ${d.event} ${d.min} dakika içinde başlıyor.`,
      region: d => `${d.region} bölgesinde şu anda ${d.n} büyük ${c('tr', d.cat)} etkinliği sürüyor.`,
      trending: d => `Bu akşam öne çıkan: ${d.city} şehrinde ${d.event} — ${n(d.likes, 'tr')} beğeni ile hızla yükseliyor.`,
      sponsor: d => d.text || `Bu yayın ${d.sponsor} tarafından sunulmaktadır.`,
      tip: () => `Küre üzerindeki parlayan noktalara dokun, orada olan her şeyi gör.`
    },
    pl: {
      welcome: d => `Witaj w Eventually! W tej chwili na świecie trwa ${n(d.count, 'pl')} wydarzeń.`,
      greeting: d => !d.hasRecs
        ? `${GREET.pl[d.part]}, ${nm(d, 'pl')}! Ustaw swoją lokalizację i kilka zainteresowań, a dobiorę wydarzenia dla Ciebie.`
        : d.exploring
          ? `${GREET.pl[d.part]}! Przeglądasz ${d.city}. Jest tu ${d.k} wydarzeń z kategorii ${c('pl', d.cat)} — w tym ${d.event}.`
          : `${GREET.pl[d.part]}, ${nm(d, 'pl')}! Na podstawie Twoich zainteresowań znalazłem ${d.k} wydarzeń ${c('pl', d.cat)} w promieniu ${d.mi} mil — w tym ${d.event} w ${d.city}.`,
      ident: d => `Przenosimy się do ${d.city} — oto co się tam dzieje.`,
      spotlight: d => `Warto zobaczyć: ${d.event} w ${d.city}. Wybiera się tam ${n(d.going, 'pl')} osób.`,
      countdown: d => `Uwaga — ${d.event} w ${d.city} zaczyna się za ${d.min} minut.`,
      region: d => `W regionie ${d.region} trwa teraz ${d.n} dużych wydarzeń ${c('pl', d.cat)}.`,
      trending: d => `Dziś na topie: ${d.event} w ${d.city} — z ${n(d.likes, 'pl')} polubieniami.`,
      sponsor: d => d.text || `Ta audycja jest prezentowana przez ${d.sponsor}.`,
      tip: () => `Dotknij dowolnego świecącego punktu na globusie, a zobaczysz wszystko, co się tam dzieje.`
    },
    ar: {
      welcome: d => `مرحبًا بك في Eventually. هناك حاليًا ${n(d.count, 'ar')} فعالية مباشرة حول العالم.`,
      greeting: d => !d.hasRecs
        ? `${GREET.ar[d.part]}، ${nm(d, 'ar')}. حدّد موقعك واهتماماتك وسأجهّز لك فعاليات مخصصة.`
        : d.exploring
          ? `${GREET.ar[d.part]}! أنت تستكشف ${d.city}. توجد الآن ${d.k} فعاليات ${c('ar', d.cat)} هنا، منها ${d.event}.`
          : `${GREET.ar[d.part]}، ${nm(d, 'ar')}. بناءً على اهتماماتك، وجدت ${d.k} فعاليات ${c('ar', d.cat)} مباشرة على بُعد ${d.mi} ميل، منها ${d.event} في ${d.city}.`,
      ident: d => `ننتقل بك الآن إلى ${d.city} — إليك ما يحدث هناك الآن.`,
      spotlight: d => `الضوء الآن على ${d.event} في ${d.city} — ${n(d.going, 'ar')} شخص سيحضرون الآن.`,
      countdown: d => `يبدأ ${d.event} خلال ${d.min} دقيقة في ${d.city}.`,
      region: d => `هناك ${d.n} فعاليات ${c('ar', d.cat)} كبرى جارية الآن في ${d.region}.`,
      trending: d => `الأكثر رواجًا الآن: ${d.event} في ${d.city}، مع ${n(d.likes, 'ar')} إعجاب.`,
      sponsor: d => d.text || `هذا التحديث مقدَّم لكم من ${d.sponsor}.`,
      tip: () => `انقر على أي نقطة متوهجة لرؤية كل ما يحدث هناك.`
    },
    zh: {
      welcome: d => `欢迎来到 Eventually。目前全球有 ${n(d.count, 'zh')} 场正在进行的活动。`,
      greeting: d => !d.hasRecs
        ? `${GREET.zh[d.part]}，${nm(d, 'zh')}。设置你的位置和兴趣，我会为你推荐合适的活动。`
        : d.exploring
          ? `${GREET.zh[d.part]}！你正在探索 ${d.city}。这里现在有 ${d.k} 场${c('zh', d.cat)}活动，包括 ${d.event}。`
          : `${GREET.zh[d.part]}，${nm(d, 'zh')}。根据你的兴趣，我在 ${d.mi} 英里内找到了 ${d.k} 场正在进行的${c('zh', d.cat)}活动，包括 ${d.city} 的 ${d.event}。`,
      ident: d => `现在带你前往 ${d.city} —— 看看那里正在发生什么。`,
      spotlight: d => `本场焦点：${d.city} 的 ${d.event} —— 目前有 ${n(d.going, 'zh')} 人参加。`,
      countdown: d => `${d.event} 将在 ${d.min} 分钟后于 ${d.city} 开始。`,
      region: d => `${d.region}目前有 ${d.n} 场大型${c('zh', d.cat)}活动正在进行。`,
      trending: d => `正在流行：${d.city} 的 ${d.event}，已获得 ${n(d.likes, 'zh')} 个赞。`,
      sponsor: d => d.text || `本次播报由 ${d.sponsor} 赞助。`,
      tip: () => `点击任意发光的点，查看那里正在发生的一切。`
    }
  };

  function format(line, code) {
    const t = T[code] || T.en;
    const fn = t[line.kind] || T.en[line.kind] || function () { return ''; };
    return fn(line.data || {});
  }
  function meta(code) { return LANGS.find(function (l) { return l.code === code; }) || LANGS[0]; }

  global.EventuallyI18n = {
    LANGS: LANGS,
    format: format,
    bcp: function (code) { return meta(code).bcp; },
    isRTL: function (code) { return meta(code).rtl; }
  };
})(window);
