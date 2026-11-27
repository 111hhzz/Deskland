#!/usr/bin/env node
/**
 * 参数声明编译器（theme.json.groups → src/engine/paramDefs.ts）。
 *
 * 背景：参数的「数据面」（键 / 范围 / 步进 / 默认值 / 选项 / 文案）此前双写于
 *   ① public/themes/<id>/theme.json 的 groups（设置页消费）
 *   ② 各引擎构造器里的 sliders / displayKeys / defaultParams（桌面面板消费）
 * 两处靠人工保持一致（meadow 注释里反复强调"要和 theme.json 一致"），已发生漂移（soon 类型）。
 * 本编译器把 theme.json.groups 作为唯一源，生成 paramDefs.ts：引擎只保留表现层
 * （fmt 函数 / act 语义），范围与默认值一律从生成物取，从结构上消除漂移。
 *
 * 用法：
 *   node scripts/build-params.mjs                 # 预览输出到 .local/param-out（不写仓库）
 *   node scripts/build-params.mjs --emit         # 写 src/engine/paramDefs.ts
 *   node scripts/build-params.mjs --check-all    # 同步门禁：已提交产物必须等于源重新编译的结果
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = join(FRONTEND, 'public', 'themes');
const OUT_TS = join(FRONTEND, 'src', 'engine', 'paramDefs.ts');

const errors = [];
function fail(id, key, msg) {
  errors.push(`${id}${key ? ' → ' + key : ''}：${msg}`);
}

// ---------- 扫描 ----------

/** 读某主题的 theme.json；坏 JSON / 缺 groups 返回 null（不参与生成） */
function loadManifest(id) {
  const file = join(THEMES_DIR, id, 'theme.json');
  if (!existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (ex) {
    fail(id, null, `theme.json 解析失败：${ex.message}`);
    return null;
  }
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  const defs = {};
  for (const g of groups) {
    if (!g || typeof g !== 'object') continue;
    for (const p of Array.isArray(g.params) ? g.params : []) {
      if (!p || typeof p !== 'object') continue;
      const { key } = p;
      if (typeof key !== 'string' || !key) {
        fail(id, String(key), '参数缺 key，已跳过');
        continue;
      }
      if (defs[key]) {
        fail(id, key, '参数键重复（跨组也不允许）');
        continue;
      }
      defs[key] = normalize(id, key, p);
    }
  }
  return defs;
}

function normalize(id, key, p) {
  const type = p.type === 'bool' ? 'bool' : Array.isArray(p.options) ? 'enum' : 'number';
  const meta = { type };
  if (typeof p.label === 'string') meta.label = p.label;
  else fail(id, key, '缺 label（展示文案必须唯一源）');
  if (typeof p.hint === 'string') meta.hint = p.hint;
  if (typeof p.unit === 'string') meta.unit = p.unit;
  if (p.format === 'times' || p.format === 'percent') meta.format = p.format;

  if (type === 'bool') {
    if (typeof p.default !== 'boolean')
      fail(id, key, `bool 参数 default 必须是 boolean，实际：${JSON.stringify(p.default)}`);
    meta.default = p.default === true;
  } else if (type === 'enum') {
    const opts = p.options.filter((o) => typeof o === 'string');
    if (opts.length < 2) fail(id, key, 'enum 至少需要 2 个选项');
    meta.options = opts;
    if (typeof p.default !== 'number' || !Number.isInteger(p.default) || p.default < 0 || p.default >= opts.length)
      fail(id, key, `enum default 必须是 [0, ${opts.length - 1}] 的整数索引，实际：${JSON.stringify(p.default)}`);
    else meta.default = p.default;
    // 枚举的滑杆语义：0 .. options-1（引擎侧不再各自 hardcode max）
    meta.min = 0;
    meta.max = opts.length - 1;
    meta.step = 1;
  } else {
    if (typeof p.default !== 'number') fail(id, key, `number default 必须是数字，实际：${JSON.stringify(p.default)}`);
    for (const f of ['min', 'max']) {
      if (typeof p[f] !== 'number') fail(id, key, `number 参数缺 ${f}`);
    }
    if (typeof p.min === 'number' && typeof p.max === 'number' && p.min > p.max) fail(id, key, 'min > max');
    meta.min = p.min;
    meta.max = p.max;
    meta.step = typeof p.step === 'number' ? p.step : 1;
    meta.default = p.default;
  }
  return meta;
}

// ---------- 生成 ----------

function renderTs(defsById) {
  const ids = Object.keys(defsById).sort();
  const block = (d) =>
    Object.entries(d)
      .map(([k, m]) => {
        const fields = [`type: ${JSON.stringify(m.type)}`, `label: ${JSON.stringify(m.label)}`];
        if (m.hint !== undefined) fields.push(`hint: ${JSON.stringify(m.hint)}`);
        if (m.unit !== undefined) fields.push(`unit: ${JSON.stringify(m.unit)}`);
        if (m.format !== undefined) fields.push(`format: ${JSON.stringify(m.format)}`);
        if (m.options !== undefined) fields.push(`options: ${JSON.stringify(m.options)}`);
        if (m.min !== undefined) fields.push(`min: ${JSON.stringify(m.min)}`);
        if (m.max !== undefined) fields.push(`max: ${JSON.stringify(m.max)}`);
        if (m.step !== undefined) fields.push(`step: ${JSON.stringify(m.step)}`);
        fields.push(`default: ${JSON.stringify(m.default)}`);
        return `    ${JSON.stringify(k)}: { ${fields.join(', ')} },`;
      })
      .join('\n');
  return `// 本文件由 scripts/build-params.mjs 生成，请勿手改。源：public/themes/*/theme.json（groups）
/** 参数数据面（唯一源 = theme.json.groups）。引擎只叠加表现层：fmt 函数与 act 语义。 */
export interface ParamMeta {
  type: 'number' | 'bool' | 'enum';
  label: string;
  hint?: string;
  unit?: string;
  format?: 'times' | 'percent';
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean;
}

export const PARAM_DEFS = {
${ids.map((id) => `  ${JSON.stringify(id)}: {\n${block(defsById[id])}\n  },`).join('\n')}
} as const satisfies Record<string, Record<string, ParamMeta>>;

/** 主题开放参数的默认值表：引擎 defaultParams 与设置页 defaultsOf 共用，避免两处各写一份 */
export function paramDefaults(id: string): Record<string, number | boolean> {
  const defs = (PARAM_DEFS as Record<string, Record<string, ParamMeta>>)[id];
  if (!defs) return {};
  const out: Record<string, number | boolean> = {};
  for (const [k, m] of Object.entries(defs)) out[k] = m.default;
  return out;
}
`;
}

// ---------- 主流程 ----------

function generate() {
  const ids = readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
  const defsById = {};
  for (const id of ids) {
    const d = loadManifest(id);
    if (d) defsById[id] = d; // 坏清单不参与（错误已记）
  }
  if (errors.length) return report();
  return { defsById, ts: renderTs(defsById) };
}

function writePreview(g) {
  const outDir = join(FRONTEND, '.local', 'param-out');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'paramDefs.ts'), g.ts);
  console.log(`✔ 编译完成：${Object.keys(g.defsById).length} 个主题 → src/engine/paramDefs.ts`);
  console.log(`   预览 → ${outDir}`);
}

function writeEmit(g) {
  mkdirSync(dirname(OUT_TS), { recursive: true });
  writeFileSync(OUT_TS, g.ts);
  console.log(`✔ 已写入 ${OUT_TS}`);
}

/** 同步门禁：产物必须与源一致（防手改产物 / 漏编译） */
function checkAll() {
  const g = generate();
  if (!g) return;
  let actual = null;
  try {
    actual = readFileSync(OUT_TS, 'utf8');
  } catch {
    /* 缺文件 */
  }
  if (actual !== g.ts) {
    console.error('✘ src/engine/paramDefs.ts 与 theme.json 源不一致');
    console.error('  修复：node scripts/build-params.mjs --emit');
    process.exit(1);
  }
  console.log(`✔ 同步校验通过：${Object.keys(g.defsById).length} 个主题的参数声明`);
}

function report() {
  if (errors.length) {
    console.error(`✘ ${errors.length} 处错误：`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
}

// ---------- CLI ----------
const args = process.argv.slice(2);
if (args[0] === '--check-all') checkAll();
else if (args[0] === '--emit') {
  const g = generate();
  if (g) writeEmit(g);
} else {
  const g = generate();
  if (g) writePreview(g);
}
