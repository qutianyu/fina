import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface KbState {
  kbPath: string | null;
  setKbPath: (path: string | null) => void;
  loadKbPath: () => Promise<void>;
}

export const useKbStore = create<KbState>()(
  persist(
    (set) => ({
      kbPath: null,
      setKbPath: (path) => set({ kbPath: path }),
      loadKbPath: async () => {
        try {
          const path = await window.electronAPI.getKbPath();
          set({ kbPath: path });
        } catch (error) {
          console.error('Failed to load KB path:', error);
        }
      },
    }),
    {
      name: 'fina-kb-storage',
    }
  )
);
