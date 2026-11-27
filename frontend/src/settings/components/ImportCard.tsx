// 「+ 导入」按钮（选择通道）：点击 → 宿主原生对话框（路径通道，无大小限制，批量）。
// 拖拽通道在 ThemeList 的工具行（整行热区），导入结果提示也挂在那一行下方。
import { useRef } from 'react';
import { useSettings } from '../store.js';

export const IMPORT_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.avif,.mp4,.webm,.dlp,.zip';

export function ImportCard() {
  const { t, importPick, importFiles } = useSettings();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        className="ghost-btn import-pick"
        id="importPick"
        onClick={importPick}
        title={t('importHint')}
        aria-label={t('importHint')}
      >
        + {t('importPick')}
      </button>
      <input
        ref={inputRef}
        type="file"
        id="importInput"
        multiple
        accept={IMPORT_ACCEPT}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) importFiles(files);
          e.target.value = ''; // 同一文件可再次选择
        }}
      />
    </>
  );
}
