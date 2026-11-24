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
 *   node scripts/build-tokens.mjs                 # 预览输出到 .local/token-out（不写仓库）
 *   node scripts/build-tokens.mjs --emit         # 写 public/themes/各主题/theme.css、theme.json.tokens、src/engine/tokens.ts
 *   node scripts/build-tokens.mjs --check-all    # 同步门禁：已提交产物必须等于 token 源重新编译的结果
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
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

// 索引："group.role" → entry。解析必须按作用域传递：core 用 coreIndex，主题用「core + 本主题覆盖」，
// 否则跨主题同名引用会串值（红队发现的先到先得缺陷）。
function lookup(ref, idx) {
  const e = idx.get(ref);
  if (!e) fail('(token 源)', ref.split('.'), `别名指向不存在的 token：{${ref}}`);
  return e;
}

// 返回 { value, type }：type 沿别名链追溯到最终来源，用于类型一致性检查
function resolveValue(entry, stack, idx) {
  const v = entry.def.$value;
  if (typeof v !== 'string') return { value: v, type: entry.type };
  const m = v.match(/^\{([a-z0-9-]+(?:\.[a-z0-9-]+)+)\}$/);
  if (!m) return { value: v, type: entry.type };
  if (stack.has(entry.name)) {
    fail(entry.file, entry.path, `别名循环：${[...stack, entry.name].join(' → ')}`);
    return { value: v, type: entry.type };
  }
  const target = lookup(m[1], idx);
  if (!target) return { value: v, type: entry.type };
  stack.add(entry.name);
  const r = resolveValue(target, stack, idx);
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

/** 解析全部 token，返回 { coreResolved, themeResolved, uniforms }；出错时返回 null 并 report()。 */
function generate() {
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

  const all = [...coreEntries];
  for (const list of themeMap.values()) all.push(...list);
  for (const e of all) validate(e);
  if (errors.length) return report();

  const keyOf = (e) => e.path.join('.');
  const coreIndex = new Map();
  for (const e of coreEntries) if (!coreIndex.has(keyOf(e))) coreIndex.set(keyOf(e), e);

  const resolveEntry = (e, idx) => {
    const r = resolveValue(e, new Set(), idx);
    e.value = r.value;
    validateValue(e, r.value);
    return e;
  };

  const coreResolved = new Map();
  for (const e of coreEntries) coreResolved.set(e.name, resolveEntry(e, coreIndex));

  const themeResolved = new Map();
  for (const [id, list] of themeMap) {
    // 每个主题独立索引：core + 本主题覆盖；跨主题引用视为缺失并报错
    const idx = new Map(coreIndex);
    for (const e of list) idx.set(keyOf(e), e);
    const merged = new Map(coreResolved);
    for (const e of list) merged.set(e.name, resolveEntry(e, idx)); // 主题覆盖 core 同名 token
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

  return {
    coreResolved,
    themeResolved,
    uniforms,
    tokensTs: renderTokensTs(
      Object.fromEntries(coreResolved),
      Object.fromEntries([...themeResolved].map(([id, m]) => [id, Object.fromEntries(m)])),
      uniforms,
    ),
  };
}

/** 开发预览输出：CSS 与 TS 都落到 .local/token-out */
function writePreview(g) {
  const outDir = join(FRONTEND, '.local', 'token-out');
  for (const [id, merged] of g.themeResolved) {
    const cssPath = join(outDir, 'themes', id, 'theme.css');
    mkdirSync(dirname(cssPath), { recursive: true });
    writeFileSync(cssPath, renderThemeCss(id, merged));
  }
  mkdirSync(join(outDir, 'engine'), { recursive: true });
  writeFileSync(join(outDir, 'engine', 'tokens.ts'), g.tokensTs);
  console.log(`✔ 编译完成：core ${g.coreResolved.size} 个 token；主题 ${[...g.themeResolved.keys()].join(', ')}`);
  console.log(`   CSS  → ${join(outDir, 'themes')}`);
  console.log(`   TS   → ${join(outDir, 'engine', 'tokens.ts')}`);
  console.log(`   uniform 映射 ${Object.keys(g.uniforms).length} 条`);
}

/** theme.json 的 tokens 视图：本主题生效全景（core + 覆盖），供人 / AI / 测试消费；宿主白名单会丢弃该段。 */
function renderTokensJson(merged) {
  const groups = {};
  for (const [name, entry] of [...merged].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cat = entry.path[0];
    const key = name.slice(cat.length + 3); // 去掉 "--" 前缀与分类后的连字符
    (groups[cat] ??= {})[key] = { type: entry.type, description: entry.description };
  }
  return groups;
}

/** 正式产出：theme.css 覆盖 public/themes/<id>/，tokens.ts 落到 src/engine/，theme.json.tokens 更新为生效视图 */
function writeEmit(g) {
  for (const [id, merged] of g.themeResolved) {
    const dir = join(FRONTEND, 'public', 'themes', id);
    const cssPath = join(dir, 'theme.css');
    mkdirSync(dirname(cssPath), { recursive: true });
    writeFileSync(cssPath, renderThemeCss(id, merged));

    const jsonPath = join(dir, 'theme.json');
    if (existsSync(jsonPath)) {
      const manifest = JSON.parse(readFileSync(jsonPath, 'utf8'));
      manifest.tokens = renderTokensJson(merged);
      writeFileSync(jsonPath, JSON.stringify(manifest, null, 2) + '\n');
    }
  }
  const tsPath = join(FRONTEND, 'src', 'engine', 'tokens.ts');
  mkdirSync(dirname(tsPath), { recursive: true });
  writeFileSync(tsPath, g.tokensTs);
  console.log(`✔ 已写入 ${g.themeResolved.size} 个主题的 theme.css / theme.json.tokens 与 src/engine/tokens.ts`);
}

/** 同步门禁：已提交的产物必须与 token 源重新编译的结果一致（防止手改产物 / 漏编译） */
function checkAll() {
  const g = generate();
  if (!g) return;
  const bad = [];
  for (const [id, merged] of g.themeResolved) {
    const cssPath = join(FRONTEND, 'public', 'themes', id, 'theme.css');
    let actual = null;
    try {
      actual = readFileSync(cssPath, 'utf8');
    } catch {
      /* 缺文件 */
    }
    if (actual !== renderThemeCss(id, merged)) bad.push('public/themes/' + id + '/theme.css');

    const jsonPath = join(FRONTEND, 'public', 'themes', id, 'theme.json');
    if (existsSync(jsonPath)) {
      const manifest = JSON.parse(readFileSync(jsonPath, 'utf8'));
      if (JSON.stringify(manifest.tokens) !== JSON.stringify(renderTokensJson(merged))) {
        bad.push('public/themes/' + id + '/theme.json(tokens)');
      }
    }
  }
  const tsPath = join(FRONTEND, 'src', 'engine', 'tokens.ts');
  let tsActual = null;
  try {
    tsActual = readFileSync(tsPath, 'utf8');
  } catch {
    /* 缺文件 */
  }
  if (tsActual !== g.tokensTs) bad.push('src/engine/tokens.ts');
  if (bad.length) {
    console.error(`✘ 产物与 token 源不一致（${bad.length} 处）：`);
    for (const f of bad) console.error('  - ' + f);
    console.error('  修复：node scripts/build-tokens.mjs --emit');
    process.exit(1);
  }
  console.log(`✔ 同步校验通过：${g.themeResolved.size} 个主题 CSS + src/engine/tokens.ts`);
}

function report() {
  if (errors.length) {
    console.error(`✘ ${errors.length} 处错误：`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
}

// ---------- CLI ----------
// 同步门禁统一用 --check-all（产物↔源）；旧的逐主题手写 CSS 比对已废弃：
// base.css 不再携带 :root，旧命令会退化为拿生成物和它自己比，恒绿无意义。

const args = process.argv.slice(2);
if (args[0] === '--check-all') {
  checkAll();
} else if (args[0] === '--emit') {
  const g = generate();
  if (g) writeEmit(g);
} else {
  const g = generate();
  if (g) writePreview(g);
}
