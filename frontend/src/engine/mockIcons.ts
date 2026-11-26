// 演示桌面数据 + 图标字形资产（SVG path）。
// 这些只是「浏览器预览模式」下的假桌面内容与图标外观，与引擎无关；
// DeskApp 的布局逻辑在 IconLayer，这里只提供数据与字形。

export type IconCell = [number, number]; // 网格坐标（列, 行）

/* ======================================================================
   图标字形（48×48 viewBox 内的 SVG path 片段）
   ====================================================================== */
const PAGE =
  '<path d="M12 4h17l9 9v29a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fbfbfb" stroke="#c4c4c4"/><path d="M29 4v7a2 2 0 0 0 2 2h7z" fill="#dedede"/>';
const LINES = '<path d="M24 20h10M24 25h10M24 30h10M24 35h10" stroke="#c9c9c9" stroke-width="1.6"/>';
const badge = (color: string, text: string, size = 11): string =>
  `<rect x="4" y="21" width="19" height="19" rx="3" fill="${color}"/><text x="13.5" y="34.5" text-anchor="middle" font-family="Segoe UI,Arial" font-weight="700" font-size="${size}" fill="#fff">${text}</text>`;
const SVG: Record<string, string> = {
  folder:
    '<path d="M4 12a3 3 0 0 1 3-3h11l4 4h19a3 3 0 0 1 3 3v2H4z" fill="#e09b1d"/><path d="M4 17h40v20a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#ffc83d"/><path d="M4 17h40v2.5H4z" fill="#ffd978"/>',
  docx: PAGE + LINES + badge('#185abd', 'W'),
  xlsx:
    PAGE +
    '<path d="M24 19h11v17H24zM24 24.5h11M24 30h11M29.5 19v17" stroke="#9ac9a9" stroke-width="1.3" fill="none"/>' +
    badge('#107c41', 'X'),
  pdf: PAGE + LINES + badge('#d33a2c', 'PDF', 7.5),
  cad: PAGE + LINES + badge('#2a7fd4', 'DWG', 7),
  txt: PAGE + '<path d="M16 18h16M16 23h16M16 28h16M16 33h10" stroke="#9a9a9a" stroke-width="1.6"/>',
  png:
    PAGE +
    '<rect x="14" y="17" width="20" height="17" rx="1.5" fill="#8fd0f5"/><path d="M14 30l6-6 5 5 3-3 6 6v1.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 14 34z" fill="#3fa35a"/><circle cx="29" cy="21.5" r="2" fill="#fff4b8"/>',
  shot: '<rect x="3" y="13" width="42" height="25" rx="1" fill="#1d2129" stroke="#f2f2f2" stroke-width="1.5"/><rect x="6" y="16" width="14" height="3" fill="#5b8def"/><rect x="6" y="21" width="22" height="2" fill="#6c7280"/><rect x="6" y="25" width="18" height="2" fill="#6c7280"/><rect x="31" y="16" width="11" height="18" fill="#2e3440"/>',
  zip:
    PAGE +
    '<path d="M22 4v4h3v3h-3v3h3v3h-3v3h3v3h-3" stroke="#8a6d3b" stroke-width="2" fill="none"/><rect x="20" y="26" width="7" height="8" rx="1" fill="#8a6d3b"/>',
  bin: '<path d="M12 14h24l-2.5 27a3 3 0 0 1-3 2.7H17.5a3 3 0 0 1-3-2.7z" fill="rgba(215,235,250,.55)" stroke="rgba(255,255,255,.9)" stroke-width="1.2"/><path d="M10 12.5h28" stroke="rgba(255,255,255,.95)" stroke-width="2.4" stroke-linecap="round"/><path d="M19 19l1 19M24 19v19M29 19l-1 19" stroke="rgba(255,255,255,.7)" stroke-width="1.2"/>',
  pc: '<rect x="5" y="8" width="38" height="26" rx="2" fill="#1f8fe0" stroke="#bfe3ff" stroke-width="1.5"/><path d="M5 30h38" stroke="#0d5fa8" stroke-width="3"/><path d="M19 34l-2 6h14l-2-6z" fill="#9aa7b4"/>',
};
const APP_COLORS = [
  '#e8553e',
  '#2f7de1',
  '#18a058',
  '#8b5cf6',
  '#f59e0b',
  '#0ea5a4',
  '#db2777',
  '#334155',
  '#16a34a',
  '#2563eb',
];
function appSVG(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return (
    `<rect x="5" y="5" width="38" height="38" rx="9" fill="${APP_COLORS[h % APP_COLORS.length]}"/><path d="M5 14a9 9 0 0 1 9-9h20a9 9 0 0 1 9 9v6H5z" fill="#fff" opacity=".14"/>` +
    `<text x="24" y="31.5" text-anchor="middle" font-family="Segoe UI,Microsoft YaHei,Arial" font-weight="700" font-size="18" fill="#fff">${Array.from(name)[0] ?? ''}</text>`
  );
}
export const glyphOf = (name: string, type: string): string => (type === 'app' ? appSVG(name) : (SVG[type] ?? ''));

/* ======================================================================
   演示桌面内容
   ====================================================================== */
export const FILES: Array<[string, string]> = [
  ['回收站', 'bin'],
  ['项目资料', 'folder'],
  ['2026 报价单.xlsx', 'xlsx'],
  ['产品需求.docx', 'docx'],
  ['截图_0927.png', 'png'],
  ['合同扫描件.pdf', 'pdf'],
  ['新建文件夹', 'folder'],
  ['设计素材', 'folder'],
  ['旅行照片', 'folder'],
  ['安装包.zip', 'zip'],
  ['会议纪要.docx', 'docx'],
  ['壁纸灵感', 'folder'],
  ['周报.xlsx', 'xlsx'],
  ['草图.png', 'png'],
  ['旧备份', 'folder'],
  ['微信图片.png', 'png'],
  ['说明书.pdf', 'pdf'],
  ['简历.docx', 'docx'],
  ['支出表.xlsx', 'xlsx'],
  ['压缩备份.zip', 'zip'],
  ['素材图.png', 'png'],
  ['下载', 'folder'],
  ['表情包.png', 'png'],
  ['工资条.xlsx', 'xlsx'],
  ['租房合同.pdf', 'pdf'],
  ['日记.docx', 'docx'],
  ['桌面截图.png', 'png'],
];
export const EXTRA: Array<[string, string]> = [
  ['新建文本文档.txt', 'txt'],
  ['新建文件夹 (2)', 'folder'],
  ['发票.pdf', 'pdf'],
  ['数据导出.xlsx', 'xlsx'],
  ['截图_0928.png', 'png'],
  ['备忘.txt', 'txt'],
  ['归档.zip', 'zip'],
  ['新建文件夹 (3)', 'folder'],
];
const APPS = [
  '回收站',
  '此电脑',
  '微信',
  '飞书',
  '钉钉',
  '腾讯会议',
  '网易云音乐',
  '剪映',
  'Photoshop',
  'Obsidian',
  'VS Code',
  'Krita',
  'AutoCAD',
  'Rhino',
  'KeyShot',
  '百度网盘',
  'Chrome',
  'Blender',
  'Figma',
  'Notion',
  'QQ',
  'Steam',
  'Eagle',
  'OBS',
  'Kimi',
  'PureRef',
  'EV录屏',
  'NX 12.0',
  'MarkText',
  'Codex',
];
const MISC: Array<[string, string]> = [
  ['projects', 'folder'],
  ['游戏', 'folder'],
  ['todolist', 'folder'],
  ['OKR管理.xlsx', 'xlsx'],
  ['固定成本.xlsx', 'xlsx'],
  ['pdfarrange', 'app'],
  ['stp.log', 'txt'],
  ['零件.stp', 'txt'],
  ['零件.3dm', 'png'],
  ['预览', 'folder'],
];
const RIGHT: Array<[string, string]> = [
  ['plot.log', 'txt'],
  ['工具', 'folder'],
  ['归档.rar', 'zip'],
  ['1685x128.png', 'png'],
  ['微信图片.jpg', 'png'],
  ['0914.png', 'png'],
  ['微信图片 2.jpg', 'png'],
  ['images.png', 'png'],
  ['目录.docx', 'docx'],
  ['api.txt', 'txt'],
  ['c4ef.png', 'png'],
  ['0918.png', 'png'],
  ['板调整.pdf', 'pdf'],
  ['recommend.txt', 'txt'],
  ['button.stp', 'txt'],
  ['新建文本 (2).txt', 'txt'],
  ['ugstep21', 'txt'],
  ['新建文本 (3).txt', 'txt'],
  ['工作计划.txt', 'txt'],
  ['微信图片 3.jpg', 'png'],
  ['新建 DOCX.docx', 'docx'],
  ['SEO.txt', 'txt'],
  ['resend.txt', 'txt'],
  ['产品介绍.txt', 'txt'],
  ['USER.pdf', 'pdf'],
  ['新建文本.txt', 'txt'],
  ['餐椅.pur', 'png'],
  ['PAP-20.pdf', 'pdf'],
  ['演示文稿.pptx', 'pdf'],
  ['问题点.txt', 'txt'],
];
// 「我的桌面」布局：列 0-2 是常用应用，列 3 是杂项，列 5 是图纸，其余是截图与文件
const SHOT_CELLS: IconCell[] = [
  [6, 4],
  [6, 5],
  [6, 6],
  [6, 7],
  [6, 8],
  [7, 3],
  [7, 4],
  [7, 5],
  [7, 6],
  [7, 7],
  [8, 4],
  [8, 5],
  [8, 6],
  [9, 2],
  [9, 3],
  [9, 4],
  [9, 5],
  [9, 6],
];
const RIGHT_CELLS: IconCell[] = [
  [11, 1],
  [11, 2],
  [11, 3],
  [12, 1],
  [12, 2],
  [12, 3],
  [12, 4],
  [13, 1],
  [13, 2],
  [13, 3],
  [13, 4],
  [14, 1],
  [14, 3],
  [14, 4],
  [15, 1],
  [15, 6],
  [16, 4],
  [16, 6],
  [17, 4],
  [17, 5],
  [17, 6],
  [17, 7],
  [19, 4],
  [19, 5],
  [19, 8],
  [20, 0],
  [20, 4],
  [20, 6],
  [21, 0],
  [21, 5],
  [21, 6],
];
export function mineCells(): Array<[number, number, string, string]> {
  const out: Array<[number, number, string, string]> = [];
  let a = 0,
    m = 0,
    rgt = 0,
    sh = 0;
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 10; r++) {
      const name = APPS[a++] ?? '';
      out.push([c, r, name, name === '回收站' ? 'bin' : name === '此电脑' ? 'pc' : 'app']);
    }
  for (let r = 0; r < 10; r++) {
    const item = MISC[m++];
    if (!item) break;
    out.push([3, r, item[0], item[1]]);
  }
  for (let r = 0; r < 5; r++) out.push([5, r, `零件结构 ${r + 1}.dwg`, 'cad']);
  out.push([6, 0, '腿测试.bak', 'txt']);
  for (const [c, r] of SHOT_CELLS) out.push([c, r, `ScreenShot ${++sh}.png`, 'shot']);
  for (const [c, r] of RIGHT_CELLS) {
    const f = RIGHT[rgt++ % RIGHT.length];
    if (!f) continue;
    out.push([c, r, f[0], f[1]]);
  }
  return out;
}
