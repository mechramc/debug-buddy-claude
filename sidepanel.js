/**
 * Debug Buddy - Side Panel JavaScript (Enhanced)
 * 
 * Handles:
 * 1. Displaying captured errors with new categories
 * 2. Showing AI analysis for each error
 * 3. Copy-to-clipboard functionality for fixes
 * 4. Settings management (API key, domains)
 * 5. Real-time updates from background script
 */

// ============================================
// STATE & DOM ELEMENTS
// ============================================

const state = {
  errors: [],
  currentFilter: 'all',
  selectedErrorId: null
};

const elements = {
  errorList: document.getElementById('errorList'),
  emptyState: document.getElementById('emptyState'),
  errorCount: document.getElementById('errorCount'),
  networkCount: document.getElementById('networkCount'),
  perfCount: document.getElementById('perfCount'),
  analyzedCount: document.getElementById('analyzedCount'),
  apiKeyWarning: document.getElementById('apiKeyWarning'),
  settingsPanel: document.getElementById('settingsPanel'),
  errorModal: document.getElementById('errorModal'),
  modalBody: document.getElementById('modalBody'),
  modalTitle: document.getElementById('modalTitle'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  domainsInput: document.getElementById('domainsInput'),
  enabledToggle: document.getElementById('enabledToggle'),
  clearBtn: document.getElementById('clearBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  closeSettings: document.getElementById('closeSettings'),
  closeModal: document.getElementById('closeModal'),
  saveSettings: document.getElementById('saveSettings'),
  toggleApiKey: document.getElementById('toggleApiKey'),
  configureApiKey: document.getElementById('configureApiKey'),
  filterTabs: document.querySelectorAll('.filter-tab')
};

// ============================================
// INITIALIZATION
// ============================================

async function initialize() {
  await loadErrors();
  await loadConfig();
  setupEventListeners();
  setupMessageListener();
  console.log('[Debug Buddy] Side panel initialized');
}

async function loadErrors() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ERRORS' });
    if (response?.success) {
      state.errors = response.errors || [];
      renderErrors();
      updateStats();
    }
  } catch (error) {
    console.error('[Debug Buddy] Failed to load errors:', error);
  }
}

async function loadConfig() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    if (response?.success) {
      const config = response.config;
      
      if (!config.hasApiKey) {
        elements.apiKeyWarning.classList.remove('hidden');
      } else {
        elements.apiKeyWarning.classList.add('hidden');
      }
      
      elements.domainsInput.value = config.domains.join('\n');
      elements.enabledToggle.checked = config.enabled;
      
      const storage = await chrome.storage.sync.get(['apiKey']);
      if (storage.apiKey && storage.apiKey !== 'YOUR_API_KEY_HERE') {
        elements.apiKeyInput.value = storage.apiKey;
      }
    }
  } catch (error) {
    console.error('[Debug Buddy] Failed to load config:', error);
  }
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  elements.clearBtn.addEventListener('click', clearErrors);
  
  elements.settingsBtn.addEventListener('click', () => {
    elements.settingsPanel.classList.remove('hidden');
  });
  
  elements.closeSettings.addEventListener('click', () => {
    elements.settingsPanel.classList.add('hidden');
  });
  
  elements.closeModal.addEventListener('click', () => {
    elements.errorModal.classList.add('hidden');
    state.selectedErrorId = null;
  });
  
  elements.errorModal.addEventListener('click', (e) => {
    if (e.target === elements.errorModal) {
      elements.errorModal.classList.add('hidden');
      state.selectedErrorId = null;
    }
  });
  
  elements.saveSettings.addEventListener('click', saveSettings);
  
  elements.toggleApiKey.addEventListener('click', () => {
    const input = elements.apiKeyInput;
    if (input.type === 'password') {
      input.type = 'text';
      elements.toggleApiKey.textContent = 'Hide';
    } else {
      input.type = 'password';
      elements.toggleApiKey.textContent = 'Show';
    }
  });
  
  elements.configureApiKey.addEventListener('click', (e) => {
    e.preventDefault();
    elements.settingsPanel.classList.remove('hidden');
    elements.apiKeyInput.focus();
  });
  
  elements.filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      elements.filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentFilter = tab.dataset.filter;
      renderErrors();
    });
  });
}

function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'NEW_ERROR':
        handleNewError(message.payload);
        break;
      case 'ANALYSIS_COMPLETED':
        handleAnalysisCompleted(message.payload);
        break;
      case 'ANALYSIS_FAILED':
        handleAnalysisFailed(message.payload);
        break;
      case 'ERROR_STATUS_UPDATED':
        handleStatusUpdated(message.payload);
        break;
      case 'ERRORS_CLEARED':
        state.errors = [];
        renderErrors();
        updateStats();
        break;
    }
  });
}

// ============================================
// ERROR HANDLING
// ============================================

function handleNewError(errorRecord) {
  state.errors = [errorRecord, ...state.errors.filter(e => e.id !== errorRecord.id)];
  renderErrors();
  updateStats();
  showNotification();
}

function handleAnalysisCompleted(errorRecord) {
  const index = state.errors.findIndex(e => e.id === errorRecord.id);
  if (index !== -1) {
    state.errors[index] = errorRecord;
    renderErrors();
    updateStats();
    if (state.selectedErrorId === errorRecord.id) {
      showErrorDetail(errorRecord);
    }
  }
}

function handleAnalysisFailed(data) {
  const error = state.errors.find(e => e.id === data.id);
  if (error) {
    error.status = 'failed';
    error.analysis = { error: data.error };
    renderErrors();
    if (state.selectedErrorId === data.id) {
      showErrorDetail(error);
    }
  }
}

function handleStatusUpdated(data) {
  const error = state.errors.find(e => e.id === data.id);
  if (error) {
    error.status = data.status;
    updateErrorCard(error);
  }
}

async function clearErrors() {
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_ERRORS' });
    state.errors = [];
    renderErrors();
    updateStats();
  } catch (error) {
    console.error('[Debug Buddy] Failed to clear errors:', error);
  }
}

// ============================================
// RENDERING
// ============================================

function renderErrors() {
  const filteredErrors = filterErrors(state.errors);
  
  if (filteredErrors.length === 0) {
    elements.emptyState.classList.remove('hidden');
    const cards = elements.errorList.querySelectorAll('.error-card');
    cards.forEach(card => card.remove());
    return;
  }
  
  elements.emptyState.classList.add('hidden');
  
  const existingCards = elements.errorList.querySelectorAll('.error-card');
  existingCards.forEach(card => card.remove());
  
  filteredErrors.forEach(error => {
    const card = createErrorCard(error);
    elements.errorList.appendChild(card);
  });
}

function filterErrors(errors) {
  if (state.currentFilter === 'all') return errors;
  
  return errors.filter(error => {
    switch (state.currentFilter) {
      case 'error': 
        return error.type === 'error' || error.type === 'exception' || error.type === 'promise_rejection';
      case 'warning': 
        return error.type === 'warning' || error.type === 'deprecation';
      case 'network': 
        return error.type === 'network_error' || error.type === 'network_slow' || 
               error.type === 'network_timeout' || error.type === 'resource_error' ||
               error.type === 'csp_violation' || error.category === 'network';
      case 'dom':
        return error.type === 'dom_error' || error.category === 'dom';
      case 'performance':
        return error.type === 'performance_longtask' || error.type === 'performance_cls' ||
               error.type === 'network_slow' || error.category === 'performance';
      default: 
        return true;
    }
  });
}

function createErrorCard(error) {
  const card = document.createElement('div');
  card.className = `error-card ${error.type} ${error.status}`;
  card.dataset.id = error.id;
  
  const icon = getTypeIcon(error.type);
  const severityBadge = error.analysis?.severity 
    ? `<span class="severity-badge ${error.analysis.severity}">${error.analysis.severity}</span>`
    : '';
  const statusIndicator = getStatusIndicator(error.status);
  const truncatedMessage = truncateText(error.message, 100);
  const fileInfo = error.filename 
    ? `<span class="file-info">${getFileName(error.filename)}:${error.lineno || '?'}</span>`
    : '';
  
  card.innerHTML = `
    <div class="error-card-header">
      <div class="error-type-icon">${icon}</div>
      <div class="error-info">
        <div class="error-message">${escapeHtml(truncatedMessage)}</div>
        <div class="error-meta">
          ${fileInfo}
          <span class="error-time">${formatTime(error.timestamp)}</span>
        </div>
      </div>
      <div class="error-status">
        ${severityBadge}
        ${statusIndicator}
      </div>
    </div>
  `;
  
  card.addEventListener('click', () => {
    state.selectedErrorId = error.id;
    showErrorDetail(error);
  });
  
  return card;
}

function updateErrorCard(error) {
  const card = document.querySelector(`.error-card[data-id="${error.id}"]`);
  if (card) {
    card.className = `error-card ${error.type} ${error.status}`;
    const statusEl = card.querySelector('.error-status');
    if (statusEl) {
      statusEl.innerHTML = getStatusIndicator(error.status);
    }
  }
}

function showErrorDetail(error) {
  elements.modalTitle.textContent = getTypeLabel(error.type);
  
  let content = `
    <div class="detail-section">
      <h3>Error Message</h3>
      <div class="error-message-full">${escapeHtml(error.message)}</div>
    </div>
    
    <div class="detail-section">
      <h3>Location</h3>
      <div class="location-info">
        <span class="label">File:</span> ${escapeHtml(error.filename || 'Unknown')}
        <span class="label">Line:</span> ${error.lineno || 'Unknown'}
        <span class="label">Column:</span> ${error.colno || 'Unknown'}
      </div>
    </div>
  `;
  
  if (error.metadata) {
    content += `<div class="detail-section"><h3>Details</h3><div class="metadata-grid">`;
    for (const [key, value] of Object.entries(error.metadata)) {
      if (value !== undefined && value !== null && value !== '') {
        const displayKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        content += `<div class="metadata-item"><span class="metadata-label">${escapeHtml(displayKey)}:</span><span class="metadata-value">${escapeHtml(displayValue)}</span></div>`;
      }
    }
    content += `</div></div>`;
  }
  
  if (error.source) {
    content += `<div class="detail-section"><h3>Source</h3><div class="source-info">${escapeHtml(error.source)}</div></div>`;
  }
  
  if (error.stack) {
    content += `<div class="detail-section"><h3>Stack Trace</h3><pre class="stack-trace">${escapeHtml(error.stack)}</pre></div>`;
  }
  
  if (error.status === 'analyzing') {
    content += `<div class="detail-section analysis-section"><h3>AI Analysis</h3><div class="analyzing-indicator"><div class="spinner"></div><span>Analyzing error...</span></div></div>`;
  } else if (error.status === 'completed' && error.analysis) {
    content += renderAnalysis(error.analysis);
  } else if (error.status === 'failed' && error.analysis?.error) {
    content += `<div class="detail-section analysis-section"><h3>AI Analysis</h3><div class="analysis-error"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>${escapeHtml(error.analysis.error)}</span></div></div>`;
  } else if (error.status === 'pending') {
    content += `<div class="detail-section analysis-section"><h3>AI Analysis</h3><div class="pending-indicator"><span>Waiting for analysis...</span></div></div>`;
  }
  
  elements.modalBody.innerHTML = content;
  elements.errorModal.classList.remove('hidden');
  setupCopyButtons();
}

function renderAnalysis(analysis) {
  let html = `<div class="detail-section analysis-section"><h3>AI Analysis</h3><div class="analysis-severity ${analysis.severity || 'medium'}"><span class="severity-label">Severity:</span><span class="severity-value">${(analysis.severity || 'medium').toUpperCase()}</span></div>`;
  
  if (analysis.explanation) {
    html += `<div class="analysis-block"><h4>What happened?</h4><p>${escapeHtml(analysis.explanation)}</p></div>`;
  }
  
  if (analysis.cause) {
    html += `<div class="analysis-block"><h4>Root Cause</h4><p>${escapeHtml(analysis.cause)}</p></div>`;
  }
  
  if (analysis.fix) {
    html += `<div class="analysis-block"><h4>Suggested Fix</h4><div class="code-block"><button class="copy-btn" data-copy="${escapeAttr(analysis.fix)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy Fix</button><pre><code>${escapeHtml(analysis.fix)}</code></pre></div></div>`;
  }
  
  if (analysis.prevention) {
    html += `<div class="analysis-block"><h4>Prevention</h4><p>${escapeHtml(analysis.prevention)}</p></div>`;
  }
  
  html += '</div>';
  return html;
}

function setupCopyButtons() {
  const copyBtns = document.querySelectorAll('.copy-btn');
  copyBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = btn.dataset.copy;
      
      try {
        await navigator.clipboard.writeText(text);
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Copied!`;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });
  });
}

// ============================================
// SETTINGS
// ============================================

async function saveSettings() {
  const apiKey = elements.apiKeyInput.value.trim();
  const domains = elements.domainsInput.value
    .split('\n')
    .map(d => d.trim())
    .filter(d => d.length > 0);
  const enabled = elements.enabledToggle.checked;
  
  try {
    await chrome.storage.sync.set({
      apiKey: apiKey || 'YOUR_API_KEY_HERE',
      domains: domains.length > 0 ? domains : ['localhost', '127.0.0.1'],
      enabled
    });
    
    if (apiKey && apiKey !== 'YOUR_API_KEY_HERE') {
      elements.apiKeyWarning.classList.add('hidden');
    } else {
      elements.apiKeyWarning.classList.remove('hidden');
    }
    
    elements.saveSettings.textContent = 'Saved!';
    elements.saveSettings.classList.add('success');
    
    setTimeout(() => {
      elements.saveSettings.textContent = 'Save Settings';
      elements.saveSettings.classList.remove('success');
      elements.settingsPanel.classList.add('hidden');
    }, 1500);
    
  } catch (error) {
    console.error('[Debug Buddy] Failed to save settings:', error);
    alert('Failed to save settings. Please try again.');
  }
}

// ============================================
// UTILITIES
// ============================================

function updateStats() {
  const errors = state.errors.filter(e => 
    e.type === 'error' || e.type === 'exception' || e.type === 'promise_rejection' ||
    e.type === 'warning' || e.type === 'deprecation' || e.type === 'dom_error' ||
    e.type === 'csp_violation'
  ).length;
  
  const network = state.errors.filter(e => 
    e.type === 'network_error' || e.type === 'network_slow' || 
    e.type === 'network_timeout' || e.type === 'resource_error'
  ).length;
  
  const perf = state.errors.filter(e => 
    e.type === 'performance_longtask' || e.type === 'performance_cls' ||
    e.type === 'network_slow'
  ).length;
  
  const analyzed = state.errors.filter(e => e.status === 'completed').length;
  
  elements.errorCount.textContent = errors;
  elements.networkCount.textContent = network;
  elements.perfCount.textContent = perf;
  elements.analyzedCount.textContent = analyzed;
}

function showNotification() {
  document.body.classList.add('new-error');
  setTimeout(() => document.body.classList.remove('new-error'), 300);
}

function getTypeIcon(type) {
  const icons = {
    error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    exception: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    network_error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`,
    network_slow: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    network_timeout: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><line x1="4" y1="4" x2="20" y2="20"/></svg>`,
    resource_error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
    promise_rejection: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
    dom_error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
    csp_violation: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    performance_longtask: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
    performance_cls: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`,
    deprecation: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    intervention: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`
  };
  return icons[type] || icons.error;
}

function getTypeLabel(type) {
  const labels = { 
    error: 'Console Error', 
    warning: 'Warning', 
    exception: 'Uncaught Exception', 
    network_error: 'Network Error', 
    network_slow: 'Slow Request',
    network_timeout: 'Request Timeout',
    resource_error: 'Resource Failed',
    promise_rejection: 'Promise Rejection',
    dom_error: 'DOM Error',
    csp_violation: 'CSP Violation',
    performance_longtask: 'Long Task',
    performance_cls: 'Layout Shift',
    deprecation: 'Deprecation Warning',
    intervention: 'Browser Intervention'
  };
  return labels[type] || 'Error';
}

function getStatusIndicator(status) {
  const indicators = {
    analyzing: '<div class="status-indicator analyzing"><div class="spinner-small"></div></div>',
    completed: '<div class="status-indicator completed">✓</div>',
    failed: '<div class="status-indicator failed">!</div>',
    pending: '<div class="status-indicator pending">•</div>'
  };
  return indicators[status] || indicators.pending;
}

function formatTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function truncateText(text, maxLength) {
  return text.length <= maxLength ? text : text.substring(0, maxLength) + '...';
}

function getFileName(path) {
  return path ? path.split('/').pop() : '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Initialize
document.addEventListener('DOMContentLoaded', initialize);
