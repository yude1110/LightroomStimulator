import { createContext, useContext } from 'react';
import { DEFAULTS, type Settings } from '../engine/settings';

export interface EditApi {
  s: Settings;
  /** 即時更新（拖曳中），不寫入歷史。 */
  set: (patch: Partial<Settings>) => void;
  /** 把自上次 commit 以來的變更記為一個復原步驟。 */
  commit: () => void;
  /** 更新並立即記為一個復原步驟。 */
  apply: (patch: Partial<Settings>) => void;
}

export const EditCtx = createContext<EditApi>({
  s: DEFAULTS as Settings,
  set: () => {},
  commit: () => {},
  apply: () => {},
});

export const useEdit = () => useContext(EditCtx);
