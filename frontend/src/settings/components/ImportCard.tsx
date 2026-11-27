// 导入入口（紧凑单行）：把本地图片 / 视频变成壁纸主题。
// 两条通道（与计划文档 §4.3 一致）：
//   - 「选择文件…」→ 宿主原生对话框（路径通道，无大小限制，批量）
//   - 拖拽到这一行 → File 读 base64 直传（限 20MB，超限引导改用选择）
// 视觉上保持辅助功能定位：一行工具条，不与「选一片风景」的主体争夺注意力。
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useSettings } from '../store.js';

export const IMPORT_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.avif,.mp4,.webm,.dlp,.zip';

export function ImportCard() {
  const { state, t, importPick, importFiles } = useSettings();
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) importFiles(files);
  };

  return (
    <section
      className={`import-bar${over ? ' over' : ''}`}
      id="importCard"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <button type="button" className="ghost-btn import-pick" id="importPick" onClick={importPick}>
        + {t('importPick')}
      </button>
      <span className="import-drop-hint" id="importDrop">
        {t('importDrop')}
      </span>
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
      {state.notice ? (
        <p className="import-notice" id="importNotice" role="status">
          {t(state.notice.key, state.notice.vars)}
        </p>
      ) : null}
    </section>
  );
}
