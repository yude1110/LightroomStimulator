import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Renderer, type ExportOptions, type LutData } from './engine/renderer';
import { DEFAULTS, defaults, diffFromDefaults, GEOMETRY_KEYS, lookOf, pick, type Settings } from './engine/settings';
import { BUILTIN } from './presets/builtin';
import { importPresetFiles, type Preset } from './presets/import';
import { db } from './presets/store';
import { EditCtx, type EditApi } from './ui/edit';
import { Histogram, type HistogramHandle } from './ui/Histogram';
import { Panels } from './ui/Panels';
import { PresetPanel } from './ui/PresetPanel';
import { Viewer } from './ui/Viewer';

interface Photo {
  id: string;
  name: string;
  file: File;
  thumb: string;
}
interface Edit {
  settings: Settings;
  past: Settings[];
  future: Settings[];
}

const PRESET_EXT = /\.(xmp|lrtemplate|cube|json)$/i;
const RAW_EXT = /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw)$/i;
const EXT: Record<ExportOptions['type'], string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function makeThumb(file: File): Promise<string> {
  const b = await createImageBitmap(file, { resizeHeight: 128, resizeQuality: 'medium' });
  const c = document.createElement('canvas');
  c.width = b.width;
  c.height = b.height;
  c.getContext('2d')!.drawImage(b, 0, 0);
  b.close();
  return c.toDataURL('image/jpeg', 0.8);
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [userPresets, setUserPresets] = useState<Preset[]>([]);
  const [preview, setPreview] = useState<Partial<Settings> | null>(null);
  const [before, setBefore] = useState(false);
  const [toast, setToast] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lut, setLut] = useState<LutData | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [canPaste, setCanPaste] = useState(false);

  const imageInput = useRef<HTMLInputElement>(null);
  const presetInput = useRef<HTMLInputElement>(null);
  const hist = useRef<HistogramHandle>(null);
  const lutCache = useRef(new Map<string, LutData>());
  const clipboard = useRef<Partial<Settings> | null>(null);
  const pending = useRef<Settings | null>(null);
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const toastTimer = useRef(0);

  const photo = photos.find((p) => p.id === activeId) ?? null;
  const edit = activeId ? edits[activeId] : undefined;
  const settings = edit?.settings ?? (DEFAULTS as Settings);
  const shown = useMemo(() => (preview ? { ...settings, ...preview } : settings), [settings, preview]);

  const notify = useCallback((msg: string, ms = 3500) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    if (ms) toastTimer.current = window.setTimeout(() => setToast(''), ms);
  }, []);

  // ---- 編輯與歷史 ----
  const set = useCallback((patch: Partial<Settings>) => {
    const id = activeRef.current;
    const cur = id ? editsRef.current[id] : undefined;
    if (!id || !cur) return;
    pending.current ??= cur.settings;
    setEdits((e) => ({ ...e, [id]: { ...e[id], settings: { ...e[id].settings, ...patch } } }));
  }, []);

  const commit = useCallback(() => {
    const id = activeRef.current;
    const snap = pending.current;
    pending.current = null;
    if (!id || !snap) return;
    setEdits((e) => {
      const cur = e[id];
      if (!cur || cur.settings === snap) return e;
      return { ...e, [id]: { settings: cur.settings, past: [...cur.past, snap].slice(-100), future: [] } };
    });
  }, []);

  const apply = useCallback(
    (patch: Partial<Settings>) => {
      commit();
      set(patch);
      commit();
    },
    [commit, set],
  );

  const undo = useCallback(() => {
    const id = activeRef.current;
    if (!id) return;
    commit();
    setEdits((e) => {
      const cur = e[id];
      if (!cur?.past.length) return e;
      return {
        ...e,
        [id]: { settings: cur.past[cur.past.length - 1], past: cur.past.slice(0, -1), future: [cur.settings, ...cur.future] },
      };
    });
  }, [commit]);

  const redo = useCallback(() => {
    const id = activeRef.current;
    if (!id) return;
    commit();
    setEdits((e) => {
      const cur = e[id];
      if (!cur?.future.length) return e;
      return { ...e, [id]: { settings: cur.future[0], past: [...cur.past, cur.settings], future: cur.future.slice(1) } };
    });
  }, [commit]);

  const api = useMemo<EditApi>(() => ({ s: settings, set, commit, apply }), [settings, set, commit, apply]);

  const select = useCallback(
    (id: string) => {
      commit();
      setPreview(null);
      setActiveId(id);
    },
    [commit],
  );

  // ---- 載入 ----
  useEffect(() => {
    db.all<Preset>('presets').then(setUserPresets, () => {});
  }, []);

  useEffect(() => {
    if (!photo) {
      setBitmap((old) => (old?.close(), null));
      return;
    }
    let dead = false;
    createImageBitmap(photo.file).then(
      (b) => {
        if (dead) return b.close();
        setBitmap((old) => (old?.close(), b));
      },
      () => notify(`無法解碼 ${photo.name}`),
    );
    return () => {
      dead = true;
    };
  }, [photo, notify]);

  const getLut = useCallback(async (id: string) => {
    let l = lutCache.current.get(id);
    if (!l) {
      l = await db.get<LutData>('luts', id);
      if (l) lutCache.current.set(id, l);
    }
    return l ?? null;
  }, []);

  useEffect(() => {
    if (!shown.lutId) return setLut(null);
    let dead = false;
    getLut(shown.lutId).then((l) => !dead && setLut(l));
    return () => {
      dead = true;
    };
  }, [shown.lutId, getLut]);

  // 編輯結果以檔案特徵為鍵自動保存，下次開啟同一張照片時還原。
  useEffect(() => {
    if (!activeId || !edit) return;
    const t = setTimeout(() => db.set('edits', activeId, edit.settings).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [activeId, edit?.settings]);

  const importPresets = useCallback(
    async (files: File[]) => {
      const res = await importPresetFiles(files);
      for (const l of res.luts) {
        lutCache.current.set(l.id, l);
        await db.set('luts', l.id, l);
      }
      for (const p of res.presets) await db.set('presets', p.id, p);
      if (res.presets.length) setUserPresets((u) => [...u, ...res.presets]);
      const parts = [];
      if (res.presets.length) parts.push(`已匯入 ${res.presets.length} 個預設`);
      if (res.errors.length) parts.push(`失敗：${res.errors.join('；')}`);
      if (parts.length) notify(parts.join('　'), res.errors.length ? 8000 : 3500);
    },
    [notify],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      const presetFiles = files.filter((f) => PRESET_EXT.test(f.name));
      if (presetFiles.length) await importPresets(presetFiles);

      const images = files.filter((f) => !PRESET_EXT.test(f.name));
      const added: Photo[] = [];
      const newEdits: Record<string, Edit> = {};
      const failed: string[] = [];
      let firstId: string | null = null;
      for (const file of images) {
        const id = `${file.name}|${file.size}|${file.lastModified}`;
        firstId ??= id;
        if (editsRef.current[id] || newEdits[id]) continue;
        try {
          const thumb = await makeThumb(file);
          const saved = await db.get<Partial<Settings>>('edits', id).catch(() => undefined);
          added.push({ id, name: file.name, file, thumb });
          newEdits[id] = { settings: { ...defaults(), ...saved }, past: [], future: [] };
        } catch {
          failed.push(file.name);
          if (firstId === id) firstId = null;
        }
      }
      if (added.length) {
        setPhotos((p) => [...p, ...added]);
        setEdits((e) => ({ ...e, ...newEdits }));
      }
      if (firstId) select(firstId);
      if (failed.length) {
        const raw = failed.some((n) => RAW_EXT.test(n));
        notify(`無法開啟：${failed.join('、')}${raw ? '（目前不支援 RAW 檔）' : ''}`, 8000);
      }
    },
    [importPresets, notify, select],
  );

  const removePhoto = (id: string) => {
    const i = photos.findIndex((p) => p.id === id);
    const rest = photos.filter((p) => p.id !== id);
    setPhotos(rest);
    setEdits(({ [id]: _, ...e }) => e);
    if (id === activeId) {
      pending.current = null;
      setActiveId(rest[Math.min(i, rest.length - 1)]?.id ?? null);
    }
  };

  // ---- 預設 ----
  const allPresets = useMemo(() => [...BUILTIN, ...userPresets], [userPresets]);
  const lutName = useMemo(
    () => userPresets.find((p) => p.settings.lutId && p.settings.lutId === settings.lutId)?.name,
    [userPresets, settings.lutId],
  );

  const savePreset = async (name: string) => {
    const p: Preset = { id: crypto.randomUUID(), name, group: '我的預設', settings: diffFromDefaults(settings) };
    await db.set('presets', p.id, p);
    setUserPresets((u) => [...u, p]);
    notify(`已儲存預設「${name}」`);
  };

  const deletePreset = async (p: Preset) => {
    await db.del('presets', p.id);
    setUserPresets((u) => u.filter((x) => x.id !== p.id));
  };

  // ---- 匯出 ----
  const runExport = async (opts: ExportOptions, all: boolean) => {
    const list = all ? photos : photo ? [photo] : [];
    if (!list.length) return;
    commit();
    let dir: any = null;
    if (list.length > 1 && 'showDirectoryPicker' in window) {
      try {
        dir = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      } catch {
        return; // 使用者取消
      }
    }
    setExportOpen(false);
    setBusy(true);
    let r: Renderer | null = null;
    try {
      r = new Renderer(new OffscreenCanvas(2, 2));
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        notify(`匯出中 ${i + 1} / ${list.length}…`, 0);
        const bmp = await createImageBitmap(p.file);
        await r.setImage(bmp);
        bmp.close();
        const s = editsRef.current[p.id].settings;
        r.setLut(s.lutId ? await getLut(s.lutId) : null);
        const blob = await r.exportBlob(s, opts);
        const name = `${p.name.replace(/\.[^.]+$/, '')}-edit.${EXT[opts.type]}`;
        if (dir) {
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
        } else {
          download(blob, name);
        }
      }
      notify(`已匯出 ${list.length} 張照片`);
    } catch (e) {
      notify(`匯出失敗：${e instanceof Error ? e.message : e}`, 8000);
    } finally {
      r?.dispose();
      setBusy(false);
    }
  };

  const copyLook = () => {
    if (!photo) return;
    clipboard.current = lookOf(settings);
    setCanPaste(true);
    notify('已複製調整設定');
  };
  const pasteLook = () => {
    if (!photo || !clipboard.current) return;
    apply(structuredClone(clipboard.current));
    notify('已貼上調整設定');
  };

  // ---- 快捷鍵與拖放 ----
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const typing = e.target instanceof HTMLInputElement && e.target.type !== 'range';
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && k === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && k === 'o') {
      e.preventDefault();
      imageInput.current?.click();
    } else if (mod && k === 'e') {
      e.preventDefault();
      if (photo) setExportOpen(true);
    } else if (mod && e.altKey && k === 'c') {
      e.preventDefault();
      copyLook();
    } else if (mod && e.altKey && k === 'v') {
      e.preventDefault();
      pasteLook();
    } else if (e.key === '\\') {
      setBefore(e.type === 'keydown');
    } else if (!mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target instanceof HTMLInputElement)) {
      const i = photos.findIndex((p) => p.id === activeId);
      const n = photos[i + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (n) select(n.id);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.type === 'keyup' && e.key !== '\\') return;
      keys.current(e);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const onHist = useCallback((bins: Uint32Array) => hist.current?.draw(bins), []);
  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>, fn: (f: File[]) => void) => {
    fn(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  return (
    <EditCtx.Provider value={api}>
      <div
        className={'app' + (dragOver ? ' drag' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
        onDrop={onDrop}
      >
        <header className="top">
          <span className="brand">RO Photo</span>
          <button onClick={() => imageInput.current?.click()}>開啟照片</button>
          <span className="sep" />
          <button disabled={!edit?.past.length} onClick={undo} title="Ctrl+Z">
            復原
          </button>
          <button disabled={!edit?.future.length} onClick={redo} title="Ctrl+Shift+Z">
            重做
          </button>
          <button disabled={!photo} onClick={() => apply({ ...lookOf(defaults()) })} title="清除這張照片的所有調整">
            重設
          </button>
          <button disabled={!photo} onClick={copyLook} title="複製這張照片的調整（Ctrl+Alt+C）">
            複製設定
          </button>
          <button disabled={!photo || !canPaste} onClick={pasteLook} title="貼到目前的照片（Ctrl+Alt+V）">
            貼上設定
          </button>
          <span className="sep" />
          <button disabled={!photo} onClick={() => apply({ rotate: (settings.rotate + 3) % 4 })} title="逆時針旋轉 90°">
            ↺
          </button>
          <button disabled={!photo} onClick={() => apply({ rotate: (settings.rotate + 1) % 4 })} title="順時針旋轉 90°">
            ↻
          </button>
          <button disabled={!photo} onClick={() => apply({ flipH: !settings.flipH })} title="水平翻轉">
            ⇋
          </button>
          <span className="sep" />
          <button
            disabled={!photo}
            className={before ? 'on' : ''}
            onPointerDown={() => setBefore(true)}
            onPointerUp={() => setBefore(false)}
            onPointerLeave={() => setBefore(false)}
            title="按住顯示原始影像（或按住 \ 鍵）"
          >
            原圖對照
          </button>
          <span className="grow" />
          <button className="primary" disabled={!photo || busy} onClick={() => setExportOpen(true)} title="Ctrl+E">
            匯出
          </button>
        </header>

        <PresetPanel
          presets={allPresets}
          disabled={!photo}
          onApply={(p) => {
            setPreview(null);
            apply(structuredClone(p.settings));
          }}
          onPreview={setPreview}
          onDelete={deletePreset}
          onImport={() => presetInput.current?.click()}
          onSave={savePreset}
        />

        <main className="center">
          <Viewer bitmap={bitmap} settings={shown} lut={lut} before={before} onHist={onHist} />
          {!photo && (
            <div className="empty" onClick={() => imageInput.current?.click()}>
              <div className="empty-title">把照片拖曳到這裡</div>
              <div>或點擊開啟（JPEG / PNG / WebP / AVIF）</div>
              <div className="hint">Lightroom 預設（.xmp、.lrtemplate）與 LUT（.cube）也可以直接拖進來</div>
            </div>
          )}
          {photos.length > 0 && (
            <div className="filmstrip">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className={'thumb' + (p.id === activeId ? ' on' : '')}
                  onClick={() => select(p.id)}
                  title={p.name}
                >
                  <img src={p.thumb} alt={p.name} draggable={false} />
                  <button
                    className="ghost del"
                    title="從清單移除"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePhoto(p.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </main>

        <aside className="right">
          <Histogram ref={hist} />
          <div className={'panels' + (photo ? '' : ' disabled')}>
            <Panels lutName={lutName} />
          </div>
        </aside>

        {exportOpen && photo && (
          <ExportDialog count={photos.length} onClose={() => setExportOpen(false)} onExport={runExport} />
        )}
        {toast && <div className="toast">{toast}</div>}
        {dragOver && <div className="drop-mask">放開以加入</div>}

        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => pickFiles(e, addFiles)}
        />
        <input
          ref={presetInput}
          type="file"
          accept=".xmp,.lrtemplate,.cube,.json"
          multiple
          hidden
          onChange={(e) => pickFiles(e, importPresets)}
        />
      </div>
    </EditCtx.Provider>
  );
}

function ExportDialog(props: {
  count: number;
  onClose: () => void;
  onExport: (opts: ExportOptions, all: boolean) => void;
}) {
  const [type, setType] = useState<ExportOptions['type']>('image/jpeg');
  const [quality, setQuality] = useState(92);
  const [resize, setResize] = useState(false);
  const [longEdge, setLongEdge] = useState(2560);
  const opts: ExportOptions = { type, quality: quality / 100, longEdge: resize ? Math.max(16, longEdge) : null };

  return (
    <div className="modal-mask" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>匯出</h3>
        <label>
          格式
          <select value={type} onChange={(e) => setType(e.target.value as ExportOptions['type'])}>
            <option value="image/jpeg">JPEG</option>
            <option value="image/png">PNG</option>
            <option value="image/webp">WebP</option>
          </select>
        </label>
        {type !== 'image/png' && (
          <label>
            品質 {quality}
            <input type="range" min={50} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
          </label>
        )}
        <label className="row">
          <input type="checkbox" checked={resize} onChange={(e) => setResize(e.target.checked)} />
          限制長邊
          <input
            type="number"
            min={16}
            disabled={!resize}
            value={longEdge}
            onChange={(e) => setLongEdge(Number(e.target.value))}
          />
          px
        </label>
        <div className="modal-actions">
          <button onClick={props.onClose}>取消</button>
          {props.count > 1 && <button onClick={() => props.onExport(opts, true)}>匯出全部（{props.count}）</button>}
          <button className="primary" onClick={() => props.onExport(opts, false)}>
            匯出這張
          </button>
        </div>
      </div>
    </div>
  );
}
