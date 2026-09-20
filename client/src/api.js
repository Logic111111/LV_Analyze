async function request(path, options = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  register: (email, password) => request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  listDesigns: () => request('/designs'),
  getDesign: (id) => request('/designs/' + id),
  saveDesign: (design) => request('/designs', { method: 'POST', body: JSON.stringify(design) }),
  deleteDesign: (id) => request('/designs/' + id, { method: 'DELETE' }),

  aiInsights: (summary) => request('/ai/insights', { method: 'POST', body: JSON.stringify({ summary }) })
};
