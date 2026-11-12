import { useMemo, useState } from 'react';
import type { Settings } from '../engine/settings';
import type { Preset } from '../presets/import';

interface Props {
  presets: Preset[];
  disabled: boolean;
  onApply: (p: Preset) => void;
  onPreview: (settings: Partial<Settings> | null) => void;
  onDelete: (p: Preset) => void;
  onImport: () => void;
  onSave: (name: string) => void;
}

export function PresetPanel({ presets, disabled, onApply, onPreview, onDelete, onImport, onSave }: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const m = new Map<string, Preset[]>();
    for (const p of presets) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return [...m.entries()];
  }, [presets]);

  const save = () => {
    if (name.trim()) onSave(name.trim());
    setName('');
    setNaming(false);
  };

  return (
    <aside className="left">
      <div className="panel-head">
        <span>預設</span>
        <span>
          <button className="ghost" disabled={disabled} onClick={() => setNaming(true)} title="把目前的調整存成預設">
            ＋ 儲存
          </button>
          <button className="ghost" onClick={onImport} title="匯入 .xmp / .lrtemplate / .cube / .json">
            匯入
          </button>
        </span>
      </div>
      {naming && (
        <form
          className="preset-name"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            autoFocus
            placeholder="預設名稱"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
          />
          <button type="submit">儲存</button>
        </form>
      )}
      <div className="preset-list" onMouseLeave={() => onPreview(null)}>
        {groups.map(([group, list]) => (
          <div key={group}>
            <div className="preset-group" onClick={() => setClosed({ ...closed, [group]: !closed[group] })}>
              <span className="chev">{closed[group] ? '▸' : '▾'}</span>
              {group}
              <span className="count">{list.length}</span>
            </div>
            {!closed[group] &&
              list.map((p) => (
                <div
                  key={p.id}
                  className={'preset' + (disabled ? ' disabled' : '')}
                  onMouseEnter={() => !disabled && onPreview(p.settings)}
                  onClick={() => !disabled && onApply(p)}
                >
                  <span className="preset-label">{p.name}</span>
                  {!p.builtin && (
                    <button
                      className="ghost del"
                      title="刪除預設"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreview(null);
                        onDelete(p);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>
      <div className="hint pad">滑過預設可即時預覽，點擊套用。也可以把預設檔直接拖進視窗。</div>
    </aside>
  );
}
