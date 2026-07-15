/* localStorage persistence — same keys and shapes as the pre-React app,
   so existing devices keep their teams, prefs and in-progress match */
export const LS = { teams: 'pkl.teams', prefs: 'pkl.prefs', match: 'pkl.match' };

export const load = (k, fb) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v ?? fb;
  } catch {
    return fb;
  }
};

export const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

export const remove = (k) => {
  try { localStorage.removeItem(k); } catch {}
};
