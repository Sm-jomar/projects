import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { fetchCampaign, parseCampaignCode, type CampaignError, type CampaignView } from "./campaign";
import { getKeyringSnapshot, markStale, subscribeKeyring, upsertEntry, type KeyringEntry } from "./campaignKeyring";

/** Live "My campaigns" list for this browser. */
export function useKeyring(): KeyringEntry[] {
  return useSyncExternalStore(subscribeKeyring, getKeyringSnapshot);
}

type Res = { code: string; view?: CampaignView; error?: CampaignError };

/** Fetch a campaign by code (role-filtered by the server) and keep the
 * keyring's cached name/role and stale flag in step with the answer. */
export function useCampaign(code: string | null) {
  const [res, setRes] = useState<Res | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    fetchCampaign(code).then(
      (view) => {
        if (!alive) return;
        setRes({ code, view });
        upsertEntry({ campaignId: view.campaign.id, code, role: view.role, name: view.campaign.name });
      },
      (error: CampaignError) => {
        if (!alive) return;
        setRes({ code, error });
        const id = parseCampaignCode(code)?.campaignId;
        const held = getKeyringSnapshot().find((e) => e.campaignId === id);
        if (error.status === 404 && id && held?.code === code) markStale(id);
      },
    );
    return () => { alive = false; };
  }, [code, tick]);

  const current = res && res.code === code ? res : null;
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const mutate = useCallback((fn: (v: CampaignView) => CampaignView) => {
    setRes((r) => (r && r.view ? { ...r, view: fn(r.view) } : r));
  }, []);

  return {
    view: current?.view ?? null,
    error: current?.error ?? null,
    loading: !!code && !current,
    reload,
    mutate,
  };
}
