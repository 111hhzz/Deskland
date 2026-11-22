// 设置页的类型定义：主题清单、宿主消息协议。
// 运行时数据来自宿主（host/Themes.cs 扫描 prototype/themes/ 后经 init / themes 消息下发），这里是它的单一事实来源。

export type LangCode = 'en' | 'zh-CN';
export type LangSetting = 'auto' | LangCode;
export type ThemeMode = 'auto' | 'light' | 'dark';

export interface ParamDef {
  key: string;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  default: number;
  unit?: string;
  format?: 'times' | 'percent';
  options?: string[];
}

export interface ParamGroup {
  name: string;
  params: ParamDef[];
  soon?: string[];
}

export interface ThemeDef {
  id: string;
  name: string;
  desc: string;
  page?: string;
  status: string;
  product?: string;
  adaptive?: boolean;
  author?: string;
  thumb?: string;
  thumbSource?: string;
  groups?: ParamGroup[];
}

export interface ThemeRegistry {
  themes: ThemeDef[];
}

export interface ScreenSize {
  w: number;
  h: number;
}

export interface InitPayload {
  t: 'init';
  theme: string;
  params: Record<string, Record<string, number>>;
  themes: ThemeDef[];
  screen: ScreenSize;
  autostart: boolean;
  autostartWarn: boolean;
  autostartSw: string;
  lang: LangSetting;
  themeMode: ThemeMode;
  langEff: LangCode;
  langSys: LangCode;
}

export interface UpdateState {
  version: string;
  status: string;
  progress: number;
  error: string;
}

// 设置页 → 宿主
export type OutMessage =
  | { t: 'hello' }
  | { t: 'ready' }
  | { t: 'set'; theme: string; key: string; value: number }
  | { t: 'theme'; id: string }
  | { t: 'autostart'; v: boolean }
  | { t: 'autostartWarnSeen' }
  | { t: 'lang'; v: LangSetting }
  | { t: 'themeMode'; v: ThemeMode }
  | { t: 'updateCheck' }
  | { t: 'updateProgram' }
  | { t: 'refreshThemes' }
  | { t: 'openWebsite' };

// 宿主 → 设置页
export type InMessage =
  | InitPayload
  | { t: 'themes'; themes: ThemeDef[] }
  | { t: 'themeChanged'; id: string }
  | { t: 'updateState'; version?: string; status?: string; progress?: number; error?: string }
  | { t: 'themeMode'; v: ThemeMode }
  | { t: 'lang'; v: LangSetting; eff: LangCode; sys: LangCode }
  | { t: 'autostart'; v: boolean };
