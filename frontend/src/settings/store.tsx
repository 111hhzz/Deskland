// 设置页状态容器：useReducer 管理界面状态，副作用（宿主消息、语言包、定时器）集中在这里。
// 组件只读 state、调用 actions，不再手动同步 DOM。

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import type {
  InitPayload,
  LangCode,
  LangSetting,
  ScreenSize,
  ThemeDef,
  ThemeMode,
  ThemeRegistry,
  UpdateState,
} from './types.js';
import { localizeRegistry, loadLang, translate } from './i18n.js';
import type { HostBridge } from './host.js';
import { mockInit, mockThemes } from './host.js';
import { newSeed, seedOf } from './domain.js';
import type { Params } from './domain.js';

export interface SettingsState {
  registry0: ThemeRegistry;
  theme: string;
  params: Params;
  screen: ScreenSize | null;
  langSetting: LangSetting;
  langSys: LangCode;
  lang: LangCode;
  themeMode: ThemeMode;
  autostart: boolean;
  autostartWarn: boolean;
  autostartSw: string;
  update: UpdateState;
  ready: boolean;
  search: string;
  purchaseId: string | null;
  helpOpen: boolean;
  stageLoading: boolean;
  savedFlash: boolean;
  refreshing: boolean;
  t0: number;
  /** 导入 / 删除的反馈（i18n key + 变量；null = 不显示） */
  notice: { key: string; vars?: Record<string, string | number> } | null;
}

type Action =
  | { type: 'init'; payload: InitPayload }
  | { type: 'registry'; themes: ThemeDef[] }
  | { type: 'langSetting'; v: LangSetting }
  | { type: 'lang'; lang: LangCode; langSys: LangCode; langSetting: LangSetting }
  | { type: 'themeMode'; v: ThemeMode }
  | { type: 'theme'; id: string }
  | { type: 'param'; theme: string; key: string; value: number | boolean }
  | { type: 'autostart'; v: boolean }
  | { type: 'autostartWarnOff' }
  | { type: 'update'; update: UpdateState }
  | { type: 'search'; q: string }
  | { type: 'purchase'; id: string | null }
  | { type: 'help'; open: boolean }
  | { type: 'stageLoading'; v: boolean }
  | { type: 'savedFlash'; v: boolean }
  | { type: 'refreshing'; v: boolean }
  | { type: 'notice'; notice: { key: string; vars?: Record<string, string | number> } | null };

function reducer(s: SettingsState, a: Action): SettingsState {
  switch (a.type) {
    case 'init': {
      // 清单就在 payload 里：先校验再落地，否则会拿旧清单（空）判断，theme 永远落到兜底的 beach
      const valid = a.payload.themes.find((t) => t.id === a.payload.theme && t.status === 'ready');
      return {
        ...s,
        ready: true,
        t0: performance.now(),
        registry0: { themes: a.payload.themes },
        langSetting: a.payload.lang,
        langSys: a.payload.langSys,
        lang: a.payload.langEff,
        themeMode: a.payload.themeMode,
        theme: valid ? valid.id : 'beach',
        params: a.payload.params,
        screen: a.payload.screen,
        autostart: a.payload.autostart,
        autostartWarn: a.payload.autostartWarn,
        autostartSw: a.payload.autostartSw,
      };
    }
    case 'registry':
      return { ...s, registry0: { themes: a.themes } };
    case 'langSetting':
      return { ...s, langSetting: a.v };
    case 'lang':
      return { ...s, lang: a.lang, langSys: a.langSys, langSetting: a.langSetting };
    case 'themeMode':
      return { ...s, themeMode: a.v };
    case 'theme':
      return { ...s, theme: a.id };
    case 'param':
      return { ...s, params: { ...s.params, [a.theme]: { ...s.params[a.theme], [a.key]: a.value } } };
    case 'autostart':
      return { ...s, autostart: a.v };
    case 'autostartWarnOff':
      return { ...s, autostartWarn: false };
    case 'update':
      return { ...s, update: a.update };
    case 'search':
      return { ...s, search: a.q };
    case 'purchase':
      return { ...s, purchaseId: a.id };
    case 'help':
      return { ...s, helpOpen: a.open };
    case 'stageLoading':
      return { ...s, stageLoading: a.v };
    case 'savedFlash':
      return { ...s, savedFlash: a.v };
    case 'refreshing':
      return { ...s, refreshing: a.v };
    case 'notice':
      return { ...s, notice: a.notice };
  }
}

// File → base64（分块拼 Uint8 再 btoa，避免大字符串参数爆栈）
function fileToBase64(f: File): Promise<string> {
  return f.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  });
}

function initialState(): SettingsState {
  return {
    registry0: { themes: [] },
    theme: 'beach',
    params: {},
    screen: null,
    langSetting: 'auto',
    langSys: 'zh-CN',
    lang: 'zh-CN',
    themeMode: 'auto',
    autostart: false,
    autostartWarn: false,
    autostartSw: '',
    update: { version: '', status: '', progress: -1, error: '' },
    ready: false,
    search: '',
    purchaseId: null,
    helpOpen: false,
    stageLoading: false,
    savedFlash: false,
    refreshing: false,
    t0: 0,
    notice: null,
  };
}

export interface SettingsContextValue {
  state: SettingsState;
  themes: ThemeDef[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  selectTheme: (id: string) => void;
  reseed: () => void;
  setParam: (key: string, value: number | boolean) => void;
  setAdaptive: (checked: boolean) => void;
  setAutostart: (checked: boolean) => void;
  dismissAutostartWarn: () => void;
  runUpdate: () => void;
  openPurchase: (id: string) => void;
  closePurchase: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  refreshThemes: () => void;
  setSearch: (q: string) => void;
  pickLang: (v: LangSetting) => void;
  pickThemeMode: (v: ThemeMode) => void;
  openWebsite: () => void;
  importPick: () => void;
  importFiles: (files: File[]) => void;
  deleteTheme: (id: string) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ host, children }: { host: HostBridge | null; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState());
  // 主题清单由宿主下发（init / themes 消息），这里留一份供消息回调读取（effect 只依赖 host，不随清单重跑）
  const registryRef = useRef<ThemeRegistry>({ themes: [] });
  const pending = useRef<Record<string, { theme: string; v: number | boolean }>>({});
  const scheduled = useRef(false);
  const stageTimer = useRef(0);
  const savedTimer = useRef(0);
  const savedHideTimer = useRef(0);
  const refreshTimer = useRef(0);
  const noticeTimer = useRef(0);
  // 反馈提示：5s 后自动消失（导入结果 / 删除确认等）
  const notify = useCallback((notice: { key: string; vars?: Record<string, string | number> } | null) => {
    dispatch({ type: 'notice', notice });
    window.clearTimeout(noticeTimer.current);
    if (notice) noticeTimer.current = window.setTimeout(() => dispatch({ type: 'notice', notice: null }), 5000);
  }, []);

  const themes = useMemo(() => localizeRegistry(state.registry0, state.lang), [state.registry0, state.lang]);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(state.lang, key, vars),
    [state.lang],
  );

  // 语言包：默认先读简体中文与英文（translate 有 当前 → 英文 → 简体中文 的回退链）
  useEffect(() => {
    void loadLang('zh-CN');
    void loadLang('en');
  }, []);

  // 卸载（关闭设置窗口）时清掉所有在途定时器，避免它们跑到窗口销毁之后
  useEffect(
    () => () => {
      window.clearTimeout(stageTimer.current);
      window.clearTimeout(savedTimer.current);
      window.clearTimeout(savedHideTimer.current);
      window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  // 测试同步信号：首帧回执 ready，宿主据此记 settings_ready（替代 sleep）
  useEffect(() => {
    if (!host) return;
    const raf = requestAnimationFrame(() => host.send({ t: 'ready' }));
    return () => cancelAnimationFrame(raf);
  }, [host]);

  // 宿主消息：init / themes / themeChanged / updateState / themeMode / lang / autostart
  useEffect(() => {
    if (!host) {
      void mockInit().then((payload) => {
        dispatch({ type: 'init', payload });
        if (new URLSearchParams(location.search).has('updateDemo')) {
          dispatch({ type: 'update', update: { version: '0.2.0', status: 'available', progress: -1, error: '' } });
        }
      });
      return;
    }
    const off = host.onMessage((m) => {
      switch (m.t) {
        case 'init':
          registryRef.current = { themes: m.themes };
          void loadLang(m.langEff).then(() => dispatch({ type: 'init', payload: m }));
          break;
        case 'themes': // 刷新主题：宿主重扫后回一份新清单
          window.clearTimeout(refreshTimer.current);
          registryRef.current = { themes: m.themes };
          dispatch({ type: 'registry', themes: m.themes });
          dispatch({ type: 'refreshing', v: false });
          break;
        case 'themeChanged':
          window.clearTimeout(stageTimer.current);
          dispatch({ type: 'stageLoading', v: false });
          if (registryRef.current.themes.some((x) => x.id === m.id && x.status === 'ready')) {
            dispatch({ type: 'theme', id: m.id });
          }
          break;
        case 'themeImported': {
          // id 成功 / error 错误码（文案映射在 i18n importErr*）
          const name = m.id ? (registryRef.current.themes.find((x) => x.id === m.id)?.name ?? m.id) : '';
          const codeMap: Record<string, string> = {
            too_large: 'importErrTooLarge',
            bad_ext: 'importErrFormat',
            sniff_mismatch: 'importErrContent',
            missing: 'importErrIO',
            io: 'importErrIO',
            // .dlp 包：pkg_too_large / pkg_entries / entry_path / nested_zip / asset_type / pkg_total / no_manifest / bad_json / bad_manifest
          };
          notify(m.error ? { key: codeMap[m.error] ?? 'importErrPkg' } : { key: 'importOk', vars: { name } });
          break;
        }
        case 'themeDeleted':
          notify({ key: 'deleteOk' });
          break;
        case 'updateState': {
          const version = String(m.version ?? '').trim();
          dispatch({
            type: 'update',
            update: {
              version,
              status: m.status ?? (version ? 'available' : ''),
              progress: typeof m.progress === 'number' ? m.progress : -1,
              error: m.error ?? '',
            },
          });
          break;
        }
        case 'themeMode':
          dispatch({ type: 'themeMode', v: m.v });
          break;
        case 'lang':
          void loadLang(m.eff).then(() => dispatch({ type: 'lang', lang: m.eff, langSys: m.sys, langSetting: m.v }));
          break;
        case 'autostart':
          dispatch({ type: 'autostart', v: m.v });
          break;
      }
    });
    host.send({ t: 'hello' });
    return off;
  }, [host]);

  const flush = () => {
    scheduled.current = false;
    const batch = pending.current;
    pending.current = {};
    for (const k of Object.keys(batch)) {
      const item = batch[k];
      if (!item) continue;
      host?.send({ t: 'set', theme: item.theme, key: k, value: item.v });
    }
    // 两段计时都要能取消：连续改参时旧的内层计时会提前截断新的“已保存”闪烁
    window.clearTimeout(savedTimer.current);
    window.clearTimeout(savedHideTimer.current);
    savedTimer.current = window.setTimeout(() => {
      dispatch({ type: 'savedFlash', v: true });
      savedHideTimer.current = window.setTimeout(() => dispatch({ type: 'savedFlash', v: false }), 1600);
    }, 700);
  };

  const setParam = (key: string, value: number | boolean) => {
    if (key === 'adaptive') {
      const th = themes.find((x) => x.id === state.theme);
      if (!th?.adaptive || (value !== 0 && value !== 1)) return;
    }
    dispatch({ type: 'param', theme: state.theme, key, value });
    pending.current = { ...pending.current, [key]: { theme: state.theme, v: value } };
    // 不用 requestAnimationFrame：窗口在后台时它会暂停，消息会积压
    if (!scheduled.current) {
      scheduled.current = true;
      window.setTimeout(flush, 30);
    }
  };

  const setSeed = (theme: string, v: number) => {
    dispatch({ type: 'param', theme, key: 'seed', value: v });
    host?.send({ t: 'set', theme, key: 'seed', value: v });
  };

  const selectTheme = (id: string) => {
    const th = themes.find((x) => x.id === id);
    if (!th) return;
    if (th.status === 'locked') {
      dispatch({ type: 'purchase', id });
      return;
    }
    if (id === state.theme) return;
    dispatch({ type: 'theme', id });
    host?.send({ t: 'theme', id });
    if (seedOf(id, state.params) === undefined) setSeed(id, newSeed());
    window.clearTimeout(stageTimer.current);
    dispatch({ type: 'stageLoading', v: true });
    stageTimer.current = window.setTimeout(() => dispatch({ type: 'stageLoading', v: false }), 8000);
  };

  // 手动刷新主题：让宿主重扫 prototype/themes/（不监听文件变化，用户点了才扫）
  const refreshThemes = () => {
    if (state.refreshing) return;
    dispatch({ type: 'refreshing', v: true });
    if (!host) {
      void mockThemes().then((themes) => dispatch({ type: 'registry', themes }));
      dispatch({ type: 'refreshing', v: false });
      return;
    }
    host.send({ t: 'refreshThemes' });
    // 宿主没回执时兜底复位，避免按钮一直转
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => dispatch({ type: 'refreshing', v: false }), 4000);
  };

  // 导入：选择文件由宿主弹原生对话框（路径通道，无大小限制）
  const importPick = () => {
    if (!host) {
      notify({ key: 'importNeedsHost' });
      return;
    }
    host.send({ t: 'importPick' });
  };

  // 拖拽通道：File → base64 直传（限 20MB；超限引导改用「选择文件」）
  const importFiles = (files: File[]) => {
    if (!host) {
      notify({ key: 'importNeedsHost' });
      return;
    }
    for (const f of files) {
      const ext = (f.name.split('.').pop() ?? '').toLowerCase();
      const okType = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'mp4', 'webm', 'dlp', 'zip'].includes(ext);
      if (!okType) {
        notify({ key: 'importErrFormat' });
        continue;
      }
      if (f.size > 20 * 1024 * 1024) {
        notify({ key: 'importDragTooLarge' });
        continue;
      }
      void fileToBase64(f).then((data) => host.send({ t: 'importFile', name: f.name, data }));
    }
  };

  const deleteTheme = (id: string) => {
    if (!host) return;
    host.send({ t: 'deleteTheme', id });
  };

  // 卸载时清掉提示定时器，避免泄漏到下一个实例
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const value: SettingsContextValue = {
    state,
    themes,
    t,
    selectTheme,
    reseed: () => setSeed(state.theme, newSeed()),
    setParam,
    setAdaptive: (checked) => setParam('adaptive', checked ? 1 : 0),
    setAutostart: (checked) => {
      dispatch({ type: 'autostart', v: checked });
      host?.send({ t: 'autostart', v: checked });
    },
    dismissAutostartWarn: () => {
      dispatch({ type: 'autostartWarnOff' });
      host?.send({ t: 'autostartWarnSeen' });
    },
    runUpdate: () => {
      const u = state.update;
      if (u.status === 'error' && !u.version) {
        host?.send({ t: 'updateCheck' });
        return;
      }
      if (u.version) host?.send({ t: 'updateProgram' });
    },
    openPurchase: (id) => dispatch({ type: 'purchase', id }),
    closePurchase: () => dispatch({ type: 'purchase', id: null }),
    openHelp: () => dispatch({ type: 'help', open: true }),
    closeHelp: () => dispatch({ type: 'help', open: false }),
    refreshThemes,
    importPick,
    importFiles,
    deleteTheme,
    setSearch: (q) => dispatch({ type: 'search', q }),
    pickLang: (v) => {
      dispatch({ type: 'langSetting', v });
      if (host) {
        host.send({ t: 'lang', v });
        return;
      }
      const eff = v === 'auto' ? state.langSys : v;
      void loadLang(eff).then(() => dispatch({ type: 'lang', lang: eff, langSys: state.langSys, langSetting: v }));
    },
    pickThemeMode: (v) => {
      dispatch({ type: 'themeMode', v });
      host?.send({ t: 'themeMode', v });
    },
    openWebsite: () => {
      if (host) host.send({ t: 'openWebsite' });
      else window.open('https://deskland.app/', '_blank', 'noopener');
    },
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings 必须在 SettingsProvider 内使用');
  return ctx;
}
