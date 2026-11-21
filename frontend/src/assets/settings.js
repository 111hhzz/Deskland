
'use strict';
const host = window.chrome && window.chrome.webview;
const send = m => { if (host) host.postMessage(JSON.stringify(m)); };

const state = { registry0: null, registry: null, theme: 'beach', params: {}, screen: null,
  langSetting: 'auto', langSys: 'zh-CN', autostartWarn: false, autostartSw: '',
  updateVersion: '', updateStatus: '', updateProgress: -1, updateError: '' };
const $ = id => document.getElementById(id);

/* ---------- 界面语言：文字表在 i18n/<语言>.json（ui：界面文字；themes：主题名和参数——简体中文的就是 themes.json 本身） ---------- */
// 增加语言时同步宿主 I18n.Supported 与体验版导出的语言列表。
const LANGS = { 'en': 'English', 'zh-CN': '简体中文' };
const I18N = {};
let lang = 'zh-CN';
const loadLang = code => I18N[code] ? Promise.resolve() :
  fetch('i18n/' + code + '.json').then(r => r.json()).then(j => { I18N[code] = j; }).catch(() => { I18N[code] = {}; });
// 一句界面文字：当前语言 → 英文 → 简体中文；{名字} 换成 vars 里的值
function t(key, vars) {
  const pick = c => I18N[c] && I18N[c].ui && I18N[c].ui[key];
  let str = pick(lang) ?? pick('en') ?? pick('zh-CN') ?? key;
  if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return str;
}
// 更新、授权和反馈共用同一组底层连接错误；各业务仍可覆盖成更具体的提示。
function connectionErrorText(code) {
  const keys = { network_timeout: 'networkTimeout', network_dns: 'networkDns', network_tls: 'networkTls',
    network_local: 'networkLocal', network_error: 'networkLocal', server_unavailable: 'serverUnavailable',
    server_rejected: 'serverRejected', server_invalid: 'serverInvalid', download_invalid: 'downloadInvalid' };
  return keys[code] ? t(keys[code]) : '';
}
// 没有宿主时（浏览器里调界面）"跟随系统"按浏览器的语言
function browserLang() {
  for (const l of navigator.languages || [navigator.language]) {
    const x = (l || '').toLowerCase();
    if (x.startsWith('zh')) return 'zh-CN';
    if (LANGS[x.slice(0, 2)]) return x.slice(0, 2);
  }
  return 'en';
}
// 主题名、说明、分组、参数按界面语言换：当前语言 → 英文 → themes.json 原文（简体中文）
function localizeRegistry() {
  const reg = JSON.parse(JSON.stringify(state.registry0));
  const srcs = lang === 'zh-CN' ? [] : [lang, 'en'].map(c => (I18N[c] && I18N[c].themes) || {});
  for (const th of reg.themes) {
    const trs = srcs.map(x => x[th.id]).filter(Boolean);
    const get = f => { for (const x of trs) { const v = f(x); if (v != null) return v; } return null; };
    th.name = get(x => x.name) ?? th.name;
    th.desc = get(x => x.desc) ?? th.desc;
    (th.groups || []).forEach((g, gi) => {
      g.name = get(x => x.groups && x.groups[gi]) ?? g.name;
      for (const p of g.params) {
        const q = f => get(x => x.params && x.params[p.key] ? f(x.params[p.key]) : null);
        p.label = q(y => y.label) ?? p.label;
        p.hint = q(y => y.hint) ?? p.hint;
        p.options = q(y => y.options) ?? p.options;
        p.unit = q(y => y.unit) ?? p.unit;
      }
    });
  }
  state.registry = reg;
}
function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-alt]').forEach(el => { el.alt = t(el.dataset.i18nAlt); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  // 语言 / 主题模式：胶囊按钮，点击循环切换
  $('langLbl').textContent = state.langSetting === 'auto' ? t('langAuto') : (LANGS[state.langSetting] || 'English');
  $('langBtn').setAttribute('aria-label', t('language'));
  langMenu.render(state.langSetting in LANGS ? state.langSetting : 'auto');
  applyThemeModeUI();
}
async function setLang(code) {
  if (!LANGS[code]) code = 'en';
  await Promise.all([loadLang('zh-CN'), loadLang('en'), loadLang(code)]);
  lang = code;
  localizeRegistry();
  applyStatic();
}
// 换了语言：界面上的字都重新填一遍（预览不用重新加载）
function rerenderTexts() {
  if (!state.screen) return;
  renderHead(); renderThemes(); renderControls(); showAutostartWarn(); showUpdate(); updatePurchaseText();
}
const THEME_ICONS = {
  auto: '<circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4"/>',
  light: '<circle cx="8" cy="8" r="3.4"/><path d="M8 1.6v1.4M8 13v1.4M1.6 8h1.4M13 8h1.4M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1"/>',
  dark: '<path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.4 4.4 0 0 0 7 7z"/>'
};
function applyThemeModeUI() {
  const m = state.themeMode || 'auto';
  document.documentElement.dataset.theme = m === 'auto' ? '' : m;
  $('themeModeLbl').textContent = t(m === 'auto' ? 'themeModeAuto' : (m === 'light' ? 'themeModeLight' : 'themeModeDark'));
  $('themeModeIcon').innerHTML = THEME_ICONS[m] || THEME_ICONS.auto;
  themeMenu.render(m);
}

// 胶囊按钮 + 下拉菜单（语言 / 主题模式共用）
function setupMenu(wrapId, btnId, menuId, items, onPick) {
  const wrap = $(wrapId), btn = $(btnId), menu = $(menuId);
  function close() { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
  function open() { wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
  btn.addEventListener('click', e => { e.stopPropagation(); wrap.classList.contains('open') ? close() : (menu.hidden = false, void menu.offsetWidth, open()); });
  menu.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    onPick(b.dataset.v); close();
  });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return {
    render(selected) {
      menu.innerHTML = items.map(it => `<button role="menuitemradio" aria-checked="${it.v === selected}" data-v="${it.v}">${typeof it.label === 'function' ? it.label() : it.label}</button>`).join('');
    }
  };
}

// 语言：胶囊按钮 + 菜单
const langMenu = setupMenu('langWrap', 'langBtn', 'langMenu',
  [{ v: 'auto', label: () => t('langAuto') }, { v: 'zh-CN', label: () => '简体中文' }, { v: 'en', label: () => 'English' }],
  v => {
    state.langSetting = v;
    if (host) send({ t: 'lang', v }); else setLang(v === 'auto' ? state.langSys : v).then(rerenderTexts);
  });

// 主题模式：胶囊按钮 + 菜单
const themeMenu = setupMenu('themeModeWrap', 'themeModeBtn', 'themeModeMenu',
  [{ v: 'auto', label: () => t('themeModeAuto') }, { v: 'light', label: () => t('themeModeLight') }, { v: 'dark', label: () => t('themeModeDark') }],
  v => {
    state.themeMode = v; applyThemeModeUI();
    if (host) send({ t: 'themeMode', v });
  });

/* ---------- 主题清单 ---------- */
const themeById = id => state.registry.themes.find(t => t.id === id);
function defaultsOf(theme) {
  const d = {};
  if (theme.adaptive) d.adaptive = 1;
  for (const g of theme.groups || []) for (const p of g.params) d[p.key] = p.default;
  return d;
}
function valuesOf(theme) { return Object.assign(defaultsOf(theme), state.params[theme.id] || {}); }
function fmt(p, v) {
  if (p.options) return p.options[v] || '';
  if (p.format === 'times') return '×' + v.toFixed(2);
  if (p.format === 'percent') return Math.round(v * 100) + '%';
  const s = Number.isInteger(p.step) ? String(Math.round(v)) : v.toFixed(2);
  return p.unit ? s + ' ' + p.unit : s;
}

const thumbUrl = value => String(value || '').match(/^url\(([^)]+)\)/)?.[1] || '';

// 主预览图（LCP 候选）提前获取：切换主题时预先下载，避免等到渲染才开始
function preloadImage(href) {
  const url = new URL(href, location.href).href;
  if ([...document.querySelectorAll('link[data-preload-image]')].some(l => l.href === url)) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = url;
  link.fetchPriority = 'high';
  link.setAttribute('data-preload-image', '');
  document.head.appendChild(link);
}
function renderThemes() {
  $('themes').innerHTML = state.registry.themes.map(th => {
    const locked = th.locked === true, ready = th.status === 'ready', on = th.id === state.theme;
    const label = locked ? t('lockedTitle', { name: th.name }) : th.name;
    return `<button class="theme${on ? ' on' : ''}${locked ? ' locked' : ''}" data-id="${th.id}" data-locked="${locked}" aria-pressed="${on}" aria-label="${label}" ${ready || locked ? '' : 'disabled'}>
      <div class="theme-copy"><div class="theme-meta"><span class="badge">${t(on ? 'badgeOn' : locked ? 'badgeLocked' : ready ? 'badgeReady' : 'badgeSoon')}</span>
        <svg class="theme-arrow" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 15 15 5M5 5h10v10"/></svg></div>
        <div class="name">${th.name}</div></div>
      <div class="thumb" style="background:${th.thumb || '#ccc'}">${locked ? `<span class="lock-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>` : ''}</div></button>`;
  }).join('');
}
let purchaseThemeId = null, purchaseReturnFocus = null;
function updatePurchaseText() {
  const th = themeById(purchaseThemeId);
  if (th) $('purchaseTheme').textContent = t('purchaseTheme', { name: th.name });
}
function showPurchase(id) {
  purchaseThemeId = id;
  purchaseReturnFocus = document.activeElement;
  updatePurchaseText();
  $('purchaseModal').hidden = false;
  $('purchaseWebsite').focus();
}
function closePurchase() {
  if ($('purchaseModal').hidden) return;
  $('purchaseModal').hidden = true;
  if (purchaseReturnFocus) purchaseReturnFocus.focus();
}
/* ---------- 主题搜索：按名称 / id 过滤卡片 ---------- */
$('themeSearch').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#themes .theme').forEach(el => {
    const hit = !q || el.textContent.toLowerCase().includes(q) || (el.dataset.id || '').toLowerCase().includes(q);
    el.hidden = !hit;
  });
});

$('themes').addEventListener('click', e => {
  const b = e.target.closest('.theme');
  if (!b || b.disabled) return;
  if (b.dataset.locked === 'true') { showPurchase(b.dataset.id); return; }
  if (b.dataset.id === state.theme) return;
  state.theme = b.dataset.id;
  send({ t: 'theme', id: state.theme });
  if (seedOf(state.theme) === undefined) setSeed(newSeed());   // 还没有种子：给一个，桌面从一开始就是同一张
  showTheme();
  const stage = $('stage'); stage.classList.add('loading');
  clearTimeout(stage._loadingT);
  stage._loadingT = setTimeout(() => stage.classList.remove('loading'), 8000);   // 兵底：久未回执则解除
});

/* ---------- 刷新：换一张（新的种子，按主题存进设置） ---------- */
const newSeed = () => Math.floor(Math.random() * 1e6);
const seedOf = id => (state.params[id] || {}).seed;
function setSeed(v) {
  (state.params[state.theme] = state.params[state.theme] || {}).seed = v;
  send({ t: 'set', theme: state.theme, key: 'seed', value: v });
}
$('reseed').addEventListener('click', () => setSeed(newSeed()));

/* ---------- 参数控件（按清单自动生成） ---------- */
function renderControls() {
  const theme = themeById(state.theme), vals = valuesOf(theme);
  if (!theme.groups) { $('controls').innerHTML = '<div class="empty">' + t('noParams') + '</div>'; return; }
  $('controls').innerHTML = theme.groups.map(g => `
    <details class="group" open><summary>${g.name}</summary>
      ${g.params.map(p => `
        <div class="param${vals[p.key] !== p.default ? ' changed' : ''}" id="p-${p.key}">
          <div class="row"><span class="label">${p.label}${p.hint ? `<span class="hint">${p.hint}</span>` : ''}</span>
            <span class="right">
              <button class="undo" data-reset="${p.key}" title="${t('resetOne', { v: fmt(p, p.default) })}" aria-label="${t('resetOneAria', { label: p.label })}">↺</button>
              <span class="value" id="v-${p.key}">${fmt(p, vals[p.key])}</span>
            </span></div>
          ${p.options ? `<div class="opts" data-key="${p.key}" role="radiogroup" aria-label="${p.label}">${p.options.map((o, i) =>
            `<button data-opt="${i}" class="${vals[p.key] === i ? 'on' : ''}" role="radio" aria-checked="${vals[p.key] === i}">${o}</button>`).join('')}</div>` : `
          <div class="track" title="${t('dblclickReset', { v: fmt(p, p.default) })}">
            <input type="range" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${vals[p.key]}" aria-label="${p.label}">
          </div>`}
        </div>`).join('')}
      ${g.soon ? `<div class="soon">${t('comingSoon')}${g.soon.map(s => `<span class="chip">${s}</span>`).join('')}</div>` : ''}
    </details>`).join('');
  $('controls').querySelectorAll('input[type=range]').forEach(fill);
}
function fill(inp) { inp.style.setProperty('--p', ((inp.value - inp.min) / (inp.max - inp.min) * 100) + '%'); }
const paramOf = key => themeById(state.theme).groups.flatMap(g => g.params).find(x => x.key === key);

// 改一个参数：更新界面，并排队发给宿主（拖动时每帧最多发一次）
let pending = {}, scheduled = false;
function setParam(key, v) {
  if (key === 'adaptive') {
    if (!themeById(state.theme).adaptive || (v !== 0 && v !== 1)) return;
    $('adaptive').checked = v === 1;
  } else {
    const p = paramOf(key);
    if (p.options) {
      document.querySelectorAll(`.opts[data-key="${key}"] button`).forEach(b => { const on = +b.dataset.opt === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    } else {
      const inp = document.querySelector(`input[data-key="${key}"]`);
      if (+inp.value !== v) inp.value = v;
      fill(inp);
    }
    $('v-' + key).textContent = fmt(p, v);
    $('p-' + key).classList.toggle('changed', v !== p.default);
  }
  (state.params[state.theme] = state.params[state.theme] || {})[key] = v;
  pending[key] = v;
  // 不用 requestAnimationFrame：窗口在后台或被遮住时它会暂停，消息就积压了
  if (!scheduled) { scheduled = true; setTimeout(flush, 30); }
}
$('controls').addEventListener('input', e => { if (e.target.dataset.key) setParam(e.target.dataset.key, +e.target.value); });
// 单项恢复默认：点 ↺，或双击滑块
$('controls').addEventListener('click', e => {
  const b = e.target.closest('[data-reset]');
  if (b) setParam(b.dataset.reset, paramOf(b.dataset.reset).default);
  const o = e.target.closest('[data-opt]');
  if (o) setParam(o.closest('.opts').dataset.key, +o.dataset.opt);
});
$('controls').addEventListener('dblclick', e => {
  const inp = e.target.closest('.track') && e.target.closest('.track').querySelector('input');
  if (inp) setParam(inp.dataset.key, paramOf(inp.dataset.key).default);
});
function flush() {
  scheduled = false;
  const batch = pending; pending = {};
  for (const k in batch) send({ t: 'set', theme: state.theme, key: k, value: batch[k] });
  flashSaved();
}
let savedT = 0;
function flashSaved() {
  clearTimeout(savedT);
  savedT = setTimeout(() => {
    $('saved').textContent = t('saved'); $('saved').classList.add('flash');
    setTimeout(() => { $('saved').textContent = t('autosave'); $('saved').classList.remove('flash'); }, 1600);
  }, 700);
}

$('autostart').addEventListener('change', e => send({ t: 'autostart', v: e.target.checked }));
$('adaptive').addEventListener('change', e => setParam('adaptive', e.target.checked ? 1 : 0));
$('autostartWarnOk').addEventListener('click', () => { state.autostartWarn = false; showAutostartWarn(); send({ t: 'autostartWarnSeen' }); });
// 开机自启被拦的提醒：宿主只给安全软件的名字，句子按界面语言拼
function showAutostartWarn() {
  $('autostartWarnText').textContent = state.autostartSw ? t('autostartWarnSw', { sw: state.autostartSw }) : t('autostartWarnGeneric');
  $('autostartWarn').hidden = !state.autostartWarn;
}

/* ---------- 程序更新：版本、阶段、进度和错误全部来自宿主 ---------- */
function showUpdate() {
  const status = state.updateStatus, checking = status === 'checking';
  const busy = status === 'downloading' || status === 'installing';
  const available = !!status;
  $('updateNotice').hidden = !available;
  if (!available) return;
  const percent = state.updateProgress >= 0 && state.updateProgress <= 1 ? Math.round(state.updateProgress * 100) + '%' : '';
  const errors = { canceled: 'updateCanceled', error_low_battery: 'updateLowBattery',
    error_wifi_recommended: 'updateWifiRecommended', error_wifi_required: 'updateWifiRequired',
    microsoft_package_required: 'updateStoreRequired' };
  let detail = state.updateVersion ? t('updateVersion', { version: state.updateVersion }) : '';
  if (checking) detail = t('updateChecking');
  else if (busy) detail = t(status === 'installing' ? 'updateInstalling' : 'updateDownloading', { progress: percent });
  else if (status === 'completed') detail = t('updateCompleted');
  else if (status === 'error') {
    const key = errors[state.updateError];
    detail = key ? t(key) : connectionErrorText(state.updateError) || t('updateFailed');
  }
  const titleKey = status === 'completed' ? 'updateCompletedTitle' : checking ? 'updateCheckingTitle' :
    status === 'error' ? (state.updateVersion ? 'updateFailedTitle' : 'updateCheckFailedTitle') : 'updateAvailable';
  document.querySelector('.update-copy b').textContent = t(titleKey);
  $('updateVersion').textContent = detail;
  $('updateProgram').disabled = busy || checking || status === 'completed';
  $('updateProgram').textContent = t(status === 'completed' ? 'updateDone' : busy || checking ? 'updateWorking' : status === 'error' ? 'updateRetry' : 'updateProgram');
}
$('updateProgram').addEventListener('click', () => {
  if ($('updateProgram').disabled) return;
  if (state.updateStatus === 'error' && !state.updateVersion) { send({ t: 'updateCheck' }); return; }
  if (state.updateVersion) send({ t: 'updateProgram' });
});

/* ---------- 静态主题预览：按屏幕比例排版，不加载主题页面 ---------- */
function screenCss() {
  const k = window.devicePixelRatio || 1;
  return { w: Math.round(state.screen.w / k), h: Math.round(state.screen.h / k) };
}
function layoutPreview() {
  if (!state.screen) return;
  const s = screenCss(), stage = $('stage').getBoundingClientRect();
  // 小窗口给参数区留出空间，避免预览挤得连第一个滑块都看不到。
  const maxHeight = Math.min(innerHeight * 0.42, Math.max(110, innerHeight - 520));
  const k = Math.min(stage.width / s.w, maxHeight / s.h);
  $('previewBox').style.width = Math.floor(s.w * k) + 'px';
  $('previewBox').style.height = Math.floor(s.h * k) + 'px';
}
addEventListener('resize', layoutPreview);

function renderHead() {
  const th = themeById(state.theme);
  $('themeName').textContent = th.name;
  $('adaptiveRow').hidden = !th.adaptive;
  $('adaptive').checked = valuesOf(th).adaptive !== 0;
  $('adaptive').setAttribute('aria-label', t('adaptive'));
}
function showTheme() {
  renderHead();
  renderThemes();
  renderControls();
  layoutPreview();
  const th = themeById(state.theme);
  $('preview').style.background = th.thumb || '#ccc';
  const previewUrl = thumbUrl(th.thumb);
  if (previewUrl) { $('preview').src = previewUrl; preloadImage(previewUrl); }
  const meta = $('themeMeta');
  meta.innerHTML = th.status === 'ready'
    ? `<div class="name"></div>${th.author ? '<div class="author"></div>' : ''}${th.desc ? '<div class="desc"></div>' : ''}` : '';
  if (meta.firstElementChild) meta.firstElementChild.textContent = th.name || '';
  if (th.author) { const a = meta.querySelector('.author'); if (a) a.textContent = th.author; }
  if (th.desc) { const d = meta.querySelector('.desc'); if (d) d.textContent = th.desc; }
}
$('purchaseLater').addEventListener('click', closePurchase);
$('purchaseModal').addEventListener('click', e => { if (e.target === $('purchaseModal')) closePurchase(); });
$('purchaseWebsite').addEventListener('click', () => {
  if (host) send({ t: 'openWebsite' });
  else window.open('https://deskland.app/', '_blank', 'noopener');
});

/* ---------- 使用帮助 ---------- */
let helpReturnFocus = null;
function openHelp() {
  helpReturnFocus = document.activeElement;
  $('helpModal').hidden = false;
  $('helpCloseX').focus();
}
function closeHelp() {
  if ($('helpModal').hidden) return;
  $('helpModal').hidden = true;
  if (helpReturnFocus) helpReturnFocus.focus();
}
$('helpOpen').addEventListener('click', openHelp);
$('helpCloseX').addEventListener('click', closeHelp);
$('helpDone').addEventListener('click', closeHelp);
$('helpModal').addEventListener('click', e => { if (e.target === $('helpModal')) closeHelp(); });

addEventListener('keydown', e => { if (e.key === 'Escape') { closeHelp(); closePurchase(); } });

/* ---------- 和宿主通信 ---------- */
function onHost(m) {
  if (m.t === 'init') {
    state.t0 = performance.now();
    state.langSetting = m.lang || 'auto';
    state.langSys = m.langSys || 'zh-CN';
    state.themeMode = m.themeMode || 'auto';
    { const sk = $('skeleton'); if (sk) sk.remove(); }   // 骨架屏：数据就绪即移除
    setLang(m.langEff || state.langSys).then(() => {        // 先按界面语言把文字表读进来，再画界面
      state.theme = themeById(m.theme) && themeById(m.theme).status === 'ready' ? m.theme : 'beach';
      state.params = m.params || {};
      state.screen = m.screen;
      $('autostart').checked = !!m.autostart;
      state.autostartWarn = !!m.autostartWarn;
      state.autostartSw = m.autostartSw || '';
      showAutostartWarn();
      showUpdate();
      showTheme();
      document.documentElement.classList.add('ready');
      window.__desklandSettingsPerf = Math.round(performance.now() - (state.t0 || 0));   // 首屏可交互耗时（测试用）
    });
  } else if (m.t === 'themeChanged') {
    if (!themeById(m.id) || themeById(m.id).status !== 'ready') return;
    state.theme = m.id;
    showTheme();
    const st = $('stage'); st.classList.remove('loading'); clearTimeout(st._loadingT);
  } else if (m.t === 'updateState') {
    state.updateVersion = String(m.version || '').trim();
    state.updateStatus = m.status || (state.updateVersion ? 'available' : '');
    state.updateProgress = typeof m.progress === 'number' ? m.progress : -1;
    state.updateError = m.error || '';
    showUpdate();
  } else if (m.t === 'updateAvailable') {              // 兼容旧开发联调消息
    onHost({ t: 'updateState', version: m.version, status: 'available', progress: -1 });
  } else if (m.t === 'themeMode') {
    state.themeMode = m.v || 'auto';
    applyThemeModeUI();
  } else if (m.t === 'lang') {                                // 换了语言（宿主已经存好、换好托盘菜单）
    state.langSetting = m.v;
    state.langSys = m.sys || state.langSys;
    setLang(m.eff).then(rerenderTexts);
  } else if (m.t === 'autostart') {
    $('autostart').checked = !!m.v;
  }
}

// 单独在浏览器里打开时（没有宿主）：用模拟的桌面数据，方便调界面
function mockHost() {
  const k = window.devicePixelRatio || 1, W = 1707, H = 1067, r = [];
  const cell = (c, row) => { const x = 4 + c * 76, y = 6 + row * 100; r.push([x * k, y * k, (x + 76) * k, (y + 92) * k]); };
  for (let c = 0; c < 4; c++) for (let row = 0; row < 9; row++) cell(c, row);
  for (const [c, row] of [[6, 0], [6, 1], [7, 3], [8, 3], [8, 4], [12, 1], [13, 1], [14, 1], [13, 2], [14, 2], [20, 0], [21, 0], [19, 5], [20, 5]]) cell(c, row);
  const bl = browserLang();
  onHost({ t: 'init', theme: 'beach', params: {}, screen: { w: W * k, h: H * k }, autostart: false, lang: 'auto', langEff: bl, langSys: bl });
  if (new URLSearchParams(location.search).has('updateDemo')) onHost({ t: 'updateState', version: '0.2.0', status: 'available', progress: -1 });
}

fetch('themes.json').then(r => r.json()).then(reg => {
  state.registry0 = state.registry = reg;
  if (host) {
    host.addEventListener('message', e => onHost(JSON.parse(e.data)));
    send({ t: 'hello' });
  } else mockHost();
});

// 测试信号：DOMContentLoaded 后首个 rAF 发送 ready（供 Playwright 等待同步，替代 sleep）。
if (host) {
  requestAnimationFrame(() => {
    host.postMessage(JSON.stringify({ t: 'ready' }));
  });
}
