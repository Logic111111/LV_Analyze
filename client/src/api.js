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

  logoutAll: () => request('/auth/logout-all', { method: 'POST' }),
  sessions: () => request('/auth/sessions'),

  listDesigns: () => request('/designs'),
  getDesign: (id) => request('/designs/' + id),
  // extras: { summary (P6.5), note (version note), designId (save into a shared design) }
  saveDesign: (design, extras = {}) => request('/designs', { method: 'POST', body: JSON.stringify({ ...design, __summary: extras.summary, __note: extras.note, __designId: extras.designId }) }),
  deleteDesign: (id) => request('/designs/' + id, { method: 'DELETE' }),
  // Version history (P7.3)
  listVersions: (id) => request(`/designs/${id}/versions`),
  getVersion: (id, v) => request(`/designs/${id}/versions/${v}`),
  restoreVersion: (id, v) => request(`/designs/${id}/versions/${v}/restore`, { method: 'POST' }),
  duplicateDesign: (id, name) => request(`/designs/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ name }) }),
  // Sharing and approval workflow (P7.4)
  shareDesign: (id, orgId) => request(`/designs/${id}/share`, { method: 'POST', body: JSON.stringify({ orgId }) }),
  workflow: (id, action, comment) => request(`/designs/${id}/${action}`, { method: 'POST', body: JSON.stringify({ comment }) }),
  reviews: (id) => request(`/designs/${id}/reviews`),
  listOrgs: () => request('/orgs'),
  createOrg: (name) => request('/orgs', { method: 'POST', body: JSON.stringify({ name }) }),
  listMembers: (orgId) => request(`/orgs/${orgId}/members`),
  setMember: (orgId, email, role) => request(`/orgs/${orgId}/members`, { method: 'POST', body: JSON.stringify({ email, role }) }),
  removeMember: (orgId, userId) => request(`/orgs/${orgId}/members/${userId}`, { method: 'DELETE' }),
  audit: (orgId) => request(`/orgs/${orgId}/audit`),

  aiInsights: (summary) => request('/ai/insights', { method: 'POST', body: JSON.stringify({ summary }) })
};
