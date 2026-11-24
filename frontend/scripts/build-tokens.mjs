#!/usr/bin/env node
/**
 * Design Token 编译器（PoC）。
 *
 * 输入：tokens/core/*.tokens.json（共享默认值）+ tokens/themes/<id>/*.tokens.json（覆盖）。
 * 输出：<out>/themes/<id>/theme.css（core+覆盖合并的 :root 块）
 *       <out>/engine/tokens.ts（{ core, themes } + SCENE_UNIFORMS）
 *
 * 支持的 DTCG 字段：$value / $type / $description / $extensions.deskland.uniform。
 * 自定义类型：vec2 / vec3（数值数组；不强制 0-1，因为 light-dir / shadow-offset 会超界）。
 * 别名："$value": "{color.surface}"，跨文件解析，循环检测。
 *
 * 用法：
 *   node scripts/build-tokens.mjs                 # 输出到 .local/token-out
 *   node scripts/build-tokens.mjs --out <dir>
 *   node scripts/build-tokens.mjs --check <themeId> <base.css> <theme.css> [--strict]
 *       把生成结果与参考 CSS（base.css + 手写 theme.css）做“计算值等价”比对；
 *       默认只报差异；--strict 时 missing/extra 也视为失败（全量迁移后应开）。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_DIR = join(FRONTEND, 'tokens');

const TYPES = new Set([
  'color',
  'fontfamily',
  'duration',
  'number',
  'percentage',
  'dimension',
  'easing',
  'shadow',
  'blur',
  'zindex',
  'opacity',
  'radius',
  'calc',
  'vec2',
  'vec3',
]);

const errors = [];
function fail(file, path, msg) {
  errors.push(`${file}${path ? ' → ' + path.join('.') : ''}：${msg}`);
}

// ---------- 扫描 ----------

function scanDir(dir, bucket) {
  if (!readdirSync(dir, { withFileTypes: true })) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) scanDir(p, bucket);
    else if (e.name.endsWith('.tokens.json')) bucket.push(p);
  }
}

/** 扁平化为 token 条目；name = --<path joined by -> */
function parseFile(file) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (ex) {
    fail(file, null, `JSON 解析失败：${ex.message}`);
    return [];
  }
  const out = [];
  (function walk(node, path) {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && '$value' in v) {
        out.push({
          file,
          path: [...path, k],
          name: '--' + [...path, k].join('-'),
          def: v,
        });
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, [...path, k]);
      } else {
        fail(file, [...path, k], '既不是 token 对象（缺 $value）也不是分组');
      }
    }
  })(raw, []);
  return out;
}

function validate(entry) {
  const { def, file, path } = entry;
  const t = def.$type;
  if (typeof t !== 'string' || !TYPES.has(t)) {
    fail(file, path, `$type 非法：${JSON.stringify(t)}`);
    return;
  }
  entry.type = t;
  entry.description = typeof def.$description === 'string' ? def.$description : '';
  const u = def.$extensions?.['deskland.v1']?.uniform;
  entry.uniform = typeof u === 'string' ? u : null;
  if (entry.uniform !== null && !/^u[A-Z][A-Za-z0-9]*$/.test(entry.uniform)) {
    fail(file, path, `uniform 名非法：${JSON.stringify(u)}`);
  }
}

// 值校验：必须在别名解析之后按“最终值”执行（否则会把 {xxx} 当字面量误拒）
function validateValue(entry, value) {
  const { file, path, type: t } = entry;
  if (t === 'vec2' || t === 'vec3') {
    const n = t === 'vec2' ? 2 : 3;
    if (
      !Array.isArray(value) ||
      value.length !== n ||
      value.some((x) => typeof x !== 'number' || !Number.isFinite(x))
    ) {
      fail(file, path, `${t} 必须是 ${n} 个有限数值的数组，实际：${JSON.stringify(value)}`);
    }
  } else if (t === 'color') {
    if (typeof value !== 'string' || !/^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(String(value).trim())) {
      fail(file, path, `color 值无法识别：${JSON.stringify(value)}`);
    }
  } else if (t === 'number' || t === 'percentage' || t === 'zindex' || t === 'opacity') {
    if (typeof value !== 'number' && typeof value !== 'string')
      fail(file, path, `${t} 值类型错误：${JSON.stringify(value)}`);
  }
}

// ---------- 别名 ----------

const index = new Map(); // "group.role" → entry

function lookup(ref) {
  const e = index.get(ref);
  if (!e) fail(e?.file ?? '(未知)', ref.split('.'), `别名指向不存在的 token：{${ref}}`);
  return e;
}

// 返回 { value, type }：type 沿别名链追溯到最终来源，用于类型一致性检查
function resolveValue(entry, stack) {
  const v = entry.def.$value;
  if (typeof v !== 'string') return { value: v, type: entry.type };
  const m = v.match(/^\{([a-z0-9-]+(?:\.[a-z0-9-]+)+)\}$/);
  if (!m) return { value: v, type: entry.type };
  if (stack.has(entry.name)) {
    fail(entry.file, entry.path, `别名循环：${[...stack, entry.name].join(' → ')}`);
    return { value: v, type: entry.type };
  }
  const target = lookup(m[1]);
  if (!target) return { value: v, type: entry.type };
  stack.add(entry.name);
  const r = resolveValue(target, stack);
  stack.delete(entry.name);
  if (r.type !== entry.type) {
    fail(entry.file, entry.path, `别名 {${m[1]}} 的类型为 ${r.type}，与本 token 的 ${entry.type} 不一致`);
  }
  return r;
}

// ---------- 合并 / 生成 ----------

function serializeCssValue(v, type) {
  if (Array.isArray(v)) return v.join(' ');
  if (type === 'number' && typeof v === 'number') return String(v);
  return String(v).trim();
}

function renderThemeCss(themeId, merged) {
  const groups = new Map();
  for (const [name, entry] of merged) {
    const cat = entry.path[0];
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push([name, entry]);
  }
  const lines = [
    `/* 本文件由 scripts/build-tokens.mjs 生成（主题：${themeId}），请勿手改。`,
    ` * 源：tokens/core/*.tokens.json + tokens/themes/${themeId}/*.tokens.json`,
    ` * 内容 = core 默认值 + 本主题覆盖；页面 <link> 与热切换逻辑无需改动。 */`,
    ':root {',
  ];
  for (const [cat, items] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`  /* ---- ${cat} ---- */`);
    for (const [name, entry] of items.sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  ${name}: ${serializeCssValue(entry.value, entry.type)};`);
    }
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

function renderTokensTs(core, themes, uniforms) {
  const fmtVal = (v) => (Array.isArray(v) ? JSON.stringify(v) : JSON.stringify(String(v).trim()));
  const block = (obj) =>
    Object.entries(obj)
      .map(([name, entry]) => `    ${JSON.stringify(name)}: ${fmtVal(entry.value)},`)
      .join('\n');
  const uni = Object.entries(uniforms)
    .map(([name, u]) => `  ${JSON.stringify(name)}: ${JSON.stringify(u)},`)
    .join('\n');
  return `// 本文件由 scripts/build-tokens.mjs 生成，请勿手改。源：tokens/**/*.tokens.json
export const TOKENS = {
  core: {
${block(core)}
  },
  themes: {
${Object.entries(themes)
  .map(([id, obj]) => `    ${JSON.stringify(id)}: {\n${block(obj)}\n    },`)
  .join('\n')}
  },
} as const;

/** token 名 → WebGL uniform（仅 scene token，来自 $extensions.deskland.uniform） */
export const SCENE_UNIFORMS = {
${uni}
} as const;
`;
}

// ---------- 主流程 ----------

function build(outDir) {
  const coreFiles = [];
  scanDir(join(TOKENS_DIR, 'core'), coreFiles);
  const themeDirs = readdirSync(join(TOKENS_DIR, 'themes'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const coreEntries = [];
  const byName = (a, b) => a.localeCompare(b);
  for (const f of coreFiles.sort(byName)) coreEntries.push(...parseFile(f));
  const themeMap = new Map();
  for (const id of themeDirs.sort(byName)) {
    const files = [];
    scanDir(join(TOKENS_DIR, 'themes', id), files);
    const list = [];
    for (const f of files.sort(byName)) list.push(...parseFile(f));
    themeMap.set(id, list);
  }

  // 索引（core 在前，主题覆盖同路径时以主题为准——别名查找应优先当前主题）
  const all = [...coreEntries];
  for (const list of themeMap.values()) all.push(...list);
  for (const e of all) {
    const key = e.path.join('.');
    if (!index.has(key)) index.set(key, e); // 同路径多个主题文件时先到先得，见下方覆盖处理
  }

  // 校验 + 解析别名（先解析出最终值，再按值校验）
  for (const e of all) validate(e);
  if (errors.length) return report();
  const resolveEntry = (e) => {
    const r = resolveValue(e, new Set());
    e.value = r.value;
    validateValue(e, r.value);
    return e;
  };

  const coreResolved = new Map();
  for (const e of coreEntries) coreResolved.set(e.name, resolveEntry(e));

  const themeResolved = new Map();
  for (const [id, list] of themeMap) {
    const merged = new Map(coreResolved);
    for (const e of list) merged.set(e.name, resolveEntry(e)); // 主题覆盖 core 同名 token
    themeResolved.set(id, merged);
  }
  if (errors.length) return report(); // 解析阶段发现的错误（别名循环 / 类型不符等）在此拦截

  // uniform 映射：取每个“主题合并结果”里出现的 scene token（core 的 uniform 也由主题继承）
  const uniforms = {};
  for (const merged of themeResolved.values()) {
    for (const [name, e] of merged) {
      if (e.uniform && !uniforms[name]) uniforms[name] = e.uniform;
    }
  }

  for (const [id, merged] of themeResolved) {
    const cssPath = join(outDir, 'themes', id, 'theme.css');
    mkdirSync(dirname(cssPath), { recursive: true });
    writeFileSync(cssPath, renderThemeCss(id, merged));
  }
  mkdirSync(join(outDir, 'engine'), { recursive: true });
  writeFileSync(
    join(outDir, 'engine', 'tokens.ts'),
    renderTokensTs(
      Object.fromEntries(coreResolved),
      Object.fromEntries([...themeResolved].map(([id, m]) => [id, Object.fromEntries(m)])),
      uniforms,
    ),
  );

  console.log(`✔ 编译完成：core ${coreResolved.size} 个 token；主题 ${[...themeResolved.keys()].join(', ')}`);
  console.log(`   CSS  → ${join(outDir, 'themes')}`);
  console.log(`   TS   → ${join(outDir, 'engine', 'tokens.ts')}`);
  console.log(`   uniform 映射 ${Object.keys(uniforms).length} 条`);
}

function report() {
  if (errors.length) {
    console.error(`✘ ${errors.length} 处错误：`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
}

// ---------- check 模式：计算值等价比对 ----------

function normalizeCssValue(v) {
  let s = v.trim().toLowerCase();
  s = s.replace(/\s+/g, ' ');
  // 数值归一：0.90 → 0.9；115.0 → 115
  s = s.replace(/(?<![\w.])-?\d+\.\d+/g, (m) => String(Number(m)));
  s = s.replace(/\s*,\s*/g, ',');
  return s;
}

function extractRootVars(css) {
  // 先剥注释，否则“上一行行尾注释”会混进下一段导致漏提（PoC 实测踩过）
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const vars = new Map();
  const re = /:root\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    for (const line of m[1].split('\n')) {
      const mm = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*;?\s*$/);
      if (mm) vars.set(mm[1], mm[2]);
    }
  }
  return vars;
}

function check(themeId, baseCssPath, themeCssPath, strict) {
  const baseVars = extractRootVars(readFileSync(baseCssPath, 'utf8'));
  const themeVars = extractRootVars(readFileSync(themeCssPath, 'utf8'));
  // 参考 = base ∪ theme（后者覆盖）
  const ref = new Map(baseVars);
  for (const [k, v] of themeVars) ref.set(k, v);

  const outDir = join(FRONTEND, '.local', 'token-out');
  const genVars = extractRootVars(readFileSync(join(outDir, 'themes', themeId, 'theme.css'), 'utf8'));

  const diffs = [];
  for (const [name, rv] of ref) {
    if (!genVars.has(name)) {
      diffs.push(['missing', name, rv, null]);
      continue;
    }
    const gv = genVars.get(name);
    if (normalizeCssValue(rv) !== normalizeCssValue(gv)) diffs.push(['diff', name, rv, gv]);
  }
  for (const [name, gv] of genVars) if (!ref.has(name)) diffs.push(['extra', name, null, gv]);

  const same = diffs.filter((d) => d[0] === 'diff');
  const missing = diffs.filter((d) => d[0] === 'missing');
  const extra = diffs.filter((d) => d[0] === 'extra');
  console.log(`比对：参考 ${ref.size} 个属性 / 生成 ${genVars.size} 个`);
  console.log(`  值不同 ${same.length}；缺失 ${missing.length}；多余 ${extra.length}`);
  // 优先展示真正的问题（值不同 / 多余），缺失多为“未录入”，折叠显示
  for (const [kind, name, rv, gv] of [...same, ...extra].slice(0, 30)) {
    console.log(`  ${kind.padEnd(7)} ${name}  参考=${rv ?? '-'}  生成=${gv ?? '-'}`);
  }
  for (const [kind, name, rv] of missing.slice(0, 5)) {
    console.log(`  ${kind.padEnd(7)} ${name}  参考=${rv}`);
  }
  const hardFail = same.length > 0 || (strict && (missing.length > 0 || extra.length > 0));
  if (hardFail) process.exit(1);
}

// ---------- CLI ----------

const args = process.argv.slice(2);
if (args[0] === '--check') {
  const strict = args.includes('--strict');
  const pos = args.filter((a) => !a.startsWith('--'));
  if (pos.length !== 3) {
    console.error('用法：--check <themeId> <base.css> <theme.css> [--strict]');
    process.exit(2);
  }
  check(pos[0], pos[1], pos[2], strict);
} else {
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : join(FRONTEND, '.local', 'token-out');
  build(outDir);
  report();
}
