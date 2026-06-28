import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
}, error => Promise.reject(error));

api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      delete api.defaults.headers.common['Authorization'];
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// Invoice APIs
export const invoiceAPI = {
  getAll: (params) => api.get('/invoices', { params }),
  getById: (id) => api.get(`/invoices/${id}`),
  extract: (formData) => api.post('/invoices/extract', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }),
  upload: (formData) => api.post('/invoices', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  process: (id) => api.post(`/invoices/${id}/process`),
  update: (id, data) => api.put(`/invoices/${id}`, data),
  updateQuality: (id, data) => api.put(`/invoices/${id}/quality`, data)
};

// SAP APIs
export const sapAPI = {
  fetchPO: (poNumber) => api.get(`/sap/po/${poNumber}`),
  postGRN: (invoiceId, data) => api.post(`/sap/grn/${invoiceId}`, data),
  postIR: (invoiceId) => api.post(`/sap/ir/${invoiceId}`),
  postCreditMemo: (invoiceId, data) => api.post(`/sap/credit-memo/${invoiceId}`, data)
};

// Approval APIs
export const approvalAPI = {
  getAll: (params) => api.get('/approvals', { params }),
  getById: (id) => api.get(`/approvals/${id}`),
  approve: (id, comments) => api.put(`/approvals/${id}/approve`, { comments }),
  reject: (id, reason) => api.put(`/approvals/${id}/reject`, { reason }),
  getStats: () => api.get('/approvals/stats')
};

// Vendor APIs
export const vendorAPI = {
  getAll: (params) => api.get('/vendors', { params }),
  getById: (code) => api.get(`/vendors/${code}`),
  getAnalytics: () => api.get('/vendors/analytics'),
  seed: () => api.post('/vendors/seed')
};

// Dashboard APIs
export const dashboardAPI = {
  getStats: () => api.get('/dashboard/stats'),
  getActivity: () => api.get('/dashboard/activity')
};
