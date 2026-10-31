import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api } from "../api.js";

const StoreContext = createContext({ store: null, setStore: () => {}, loading: true, error: null, reload: async () => {} });

export function StoreProvider({ children }) {
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.storeInfo();
      setStore(data || null);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return <StoreContext.Provider value={{ store, setStore, loading, error, reload }}>{children}</StoreContext.Provider>;
}

export const useStore = () => useContext(StoreContext);
