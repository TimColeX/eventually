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
    { code: 'es', label: 'Español',  bcp: 'es-ES', rtl: false },
    { code: 'fr', label: 'Français', bcp: 'fr-FR', rtl: false },
    { code: 'ar', label: 'العربية',  bcp: 'ar-SA', rtl: true  },
    { code: 'zh', label: '中文',      bcp: 'zh-CN', rtl: false }
  ];
  const LOCALE = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', ar: 'ar-EG', zh: 'zh-CN' };
  const DEFAULT_NAME = { en: 'there', es: 'amigo', fr: 'cher visiteur', ar: 'صديقي', zh: '朋友' };
  const CAT = {
    en: { 'Music': 'music', 'Tech': 'tech', 'Business': 'business', 'Arts': 'arts', 'Food & Drink': 'food & drink', 'Sports': 'sports', 'Film & Media': 'film & media', 'Community': 'community', 'Nightlife': 'nightlife', 'Comedy': 'comedy' },
    es: { 'Music': 'música', 'Tech': 'tecnología', 'Business': 'negocios', 'Arts': 'arte', 'Food & Drink': 'gastronomía', 'Sports': 'deportes', 'Film & Media': 'cine y medios', 'Community': 'comunidad', 'Nightlife': 'vida nocturna', 'Comedy': 'comedia' },
    fr: { 'Music': 'musique', 'Tech': 'tech', 'Business': 'affaires', 'Arts': 'art', 'Food & Drink': 'gastronomie', 'Sports': 'sport', 'Film & Media': 'cinéma et médias', 'Community': 'communauté', 'Nightlife': 'vie nocturne', 'Comedy': 'comédie' },
    ar: { 'Music': 'موسيقى', 'Tech': 'تقنية', 'Business': 'أعمال', 'Arts': 'فنون', 'Food & Drink': 'طعام وشراب', 'Sports': 'رياضة', 'Film & Media': 'أفلام وإعلام', 'Community': 'مجتمع', 'Nightlife': 'حياة ليلية', 'Comedy': 'كوميديا' },
    zh: { 'Music': '音乐', 'Tech': '科技', 'Business': '商业', 'Arts': '艺术', 'Food & Drink': '美食', 'Sports': '体育', 'Film & Media': '影视', 'Community': '社区', 'Nightlife': '夜生活', 'Comedy': '喜剧' }
  };
  const GREET = {
    en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
    es: { morning: 'Buenos días', afternoon: 'Buenas tardes', evening: 'Buenas noches' },
    fr: { morning: 'Bonjour', afternoon: 'Bon après-midi', evening: 'Bonsoir' },
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
      sponsor: d => `This update is brought to you by ${d.sponsor}.`,
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
      sponsor: d => `Esta actualización es presentada por ${d.sponsor}.`,
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
      sponsor: d => `Cette mise à jour vous est présentée par ${d.sponsor}.`,
      tip: () => `Touchez un point lumineux pour voir tout ce qui s'y passe.`
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
      sponsor: d => `هذا التحديث مقدَّم لكم من ${d.sponsor}.`,
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
      sponsor: d => `本次播报由 ${d.sponsor} 赞助。`,
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
