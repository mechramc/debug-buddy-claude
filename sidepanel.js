/**
 * Debug Buddy - Side Panel JavaScript
 * 
 * This script handles:
 * 1. Displaying captured errors in a list
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
  warningCount: document.getElementById('warningCount'),
  analyzedCount: document.getElementById('analyzedCount'),
  apiKeyWarning: document.getElementById('apiKeyWarning'),
  settingsPanel: document.getElementById('settingsPanel'),
  errorModal: document.getElementById('errorModal'),
  modalBody: document.getElementById('modalBody'),
  modalTitle: document.getElementById('modalTitle'),
  // Inputs
  apiKeyInput: document.getElementById('apiKeyInput'),
  domainsInput: document.getElementById('domainsInput'),
  enabledToggle: document.getElementById('enabledToggle'),
  // Buttons
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

/**
 * Initialize the side panel
 */
async function initialize() {
  // Load existing errors
  await loadErrors();
  
  // Load and check configuration
  await loadConfig();
  
  // Set up event listeners
  setupEventListeners();
  
  // Listen for messages from background
  setupMessageListener();
  
  console.log('[Debug Buddy] Side panel initialized');
}

/**
 * Load errors from storage
 */
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

/**
 * Load configuration from storage
 */
async function loadConfig() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    if (response?.success) {
      const config = response.config;
      
      // Show/hide API key warning
      if (!config.hasApiKey) {
        elements.apiKeyWarning.classList.remove('hidden');
      } else {
        elements.apiKeyWarning.classList.add('hidden');
      }
      
      // Populate settings form
      elements.domainsInput.value = config.domains.join('\n');
      elements.enabledToggle.checked = config.enabled;
      
      // Load actual API key for settings panel
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

/**
 * Set up all event listeners
 */
function setupEventListeners() {
  // Clear errors button
  elements.clearBtn.addEventListener('click', clearErrors);
  
  // Settings button
  elements.settingsBtn.addEventListener('click', () => {
    elements.settingsPanel.classList.remove('hidden');
  });
  
  // Close settings
  elements.closeSettings.addEventListener('click', () => {
    elements.settingsPanel.classList.add('hidden');
  });
  
  // Close modal
  elements.closeModal.addEventListener('click', () => {
    elements.errorModal.classList.add('hidden');
    state.selectedErrorId = null;
  });
  
  // Click outside modal to close
  elements.errorModal.addEventListener('click', (e) => {
    if (e.target === elements.errorModal) {
      elements.errorModal.classList.add('hidden');
      state.selectedErrorId = null;
    }
  });
  
  // Save settings
  elements.saveSettings.addEventListener('click', saveSettings);
  
  // Toggle API key visibility
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
  
  // Configure API key link
  elements.configureApiKey.addEventListener('click', (e) => {
    e.preventDefault();
    elements.settingsPanel.classList.remove('hidden');
    elements.apiKeyInput.focus();
  });
  
  // Filter tabs
  elements.filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      elements.filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentFilter = tab.dataset.filter;
      renderErrors();
    });
  });
}

/**
 * Set up message listener for real-time updates
 */
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

/**
 * Handle new error from background
 */
function handleNewError(errorRecord) {
  // Add to beginning of list
  state.errors = [errorRecord, ...state.errors.filter(e => e.id !== errorRecord.id)];
  renderErrors();
  updateStats();
  
  // Show notification effect
  showNotification();
}

/**
 * Handle completed analysis
 */
function handleAnalysisCompleted(errorRecord) {
  const index = state.errors.findIndex(e => e.id === errorRecord.id);
  if (index !== -1) {
    state.errors[index] = errorRecord;
    renderErrors();
    updateStats();
    
    // Update modal if this error is currently selected
    if (state.selectedErrorId === errorRecord.id) {
      showErrorDetail(errorRecord);
    }
  }
}

/**
 * Handle failed analysis
 */
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

/**
 * Handle status update
 */
function handleStatusUpdated(data) {
  const error = state.errors.find(e => e.id === data.id);
  if (error) {
    error.status = data.status;
    updateErrorCard(error);
  }
}

/**
 * Clear all errors
 */
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

/**
 * Render the error list
 */
function renderErrors() {
  // Filter errors based on current filter
  const filteredErrors = filterErrors(state.errors);
  
  // Show/hide empty state
  if (filteredErrors.length === 0) {
    elements.emptyState.classList.remove('hidden');
    // Remove all error cards
    const cards = elements.errorList.querySelectorAll('.error-card');
    cards.forEach(card => card.remove());
    return;
  }
  
  elements.emptyState.classList.add('hidden');
  
  // Clear existing cards (but keep empty state element)
  const existingCards = elements.errorList.querySelectorAll('.error-card');
  existingCards.forEach(card => card.remove());
  
  // Render each error
  filteredErrors.forEach(error => {
    const card = createErrorCard(error);
    elements.errorList.appendChild(card);
  });
}

/**
 * Filter errors based on current filter
 */
function filterErrors(errors) {
  if (state.currentFilter === 'all') {
    return errors;
  }
  
  return errors.filter(error => {
    switch (state.currentFilter) {
      case 'error':
        return error.type === 'error' || error.type === 'exception';
      case 'warning':
        return error.type === 'warning';
      case 'network':
        return error.type === 'network_error';
      default:
        return true;
    }
  });
}

/**
 * Create an error card element
 */
function createErrorCard(error) {
  const card = document.createElement('div');
  card.className = `error-card ${error.type} ${error.status}`;
  card.dataset.id = error.id;
  
  // Type icon
  const icon = getTypeIcon(error.type);
  
  // Severity badge (if analyzed)
  const severityBadge = error.analysis?.severity 
    ? `<span class="severity-badge ${error.analysis.severity}">${error.analysis.severity}</span>`
    : '';
  
  // Status indicator
  const statusIndicator = getStatusIndicator(error.status);
  
  // Truncate message
  const truncatedMessage = truncateText(error.message, 100);
  
  // File info
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
  
  // Click handler to show details
  card.addEventListener('click', () => {
    state.selectedErrorId = error.id;
    showErrorDetail(error);
  });
  
  return card;
}

/**
 * Update a single error card
 */
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

/**
 * Show error detail modal
 */
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
  
  // Stack trace
  if (error.stack) {
    content += `
      <div class="detail-section">
        <h3>Stack Trace</h3>
        <pre class="stack-trace">${escapeHtml(error.stack)}</pre>
      </div>
    `;
  }
  
  // AI Analysis
  if (error.status === 'analyzing') {
    content += `
      <div class="detail-section analysis-section">
        <h3>AI Analysis</h3>
        <div class="analyzing-indicator">
          <div class="spinner"></div>
          <span>Analyzing error...</span>
        </div>
      </div>
    `;
  } else if (error.status === 'completed' && error.analysis) {
    content += renderAnalysis(error.analysis);
  } else if (error.status === 'failed' && error.analysis?.error) {
    content += `
      <div class="detail-section analysis-section">
        <h3>AI Analysis</h3>
        <div class="analysis-error">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>${escapeHtml(error.analysis.error)}</span>
        </div>
      </div>
    `;
  } else if (error.status === 'pending') {
    content += `
      <div class="detail-section analysis-section">
        <h3>AI Analysis</h3>
        <div class="pending-indicator">
          <span>Waiting for analysis...</span>
        </div>
      </div>
    `;
  }
  
  elements.modalBody.innerHTML = content;
  elements.errorModal.classList.remove('hidden');
  
  // Set up copy buttons
  setupCopyButtons();
}

/**
 * Render AI analysis section
 */
function renderAnalysis(analysis) {
  let html = `
    <div class="detail-section analysis-section">
      <h3>AI Analysis</h3>
      
      <div class="analysis-severity ${analysis.severity || 'medium'}">
        <span class="severity-label">Severity:</span>
        <span class="severity-value">${(analysis.severity || 'medium').toUpperCase()}</span>
      </div>
  `;
  
  if (analysis.explanation) {
    html += `
      <div class="analysis-block">
        <h4>What happened?</h4>
        <p>${escapeHtml(analysis.explanation)}</p>
      </div>
    `;
  }
  
  if (analysis.cause) {
    html += `
      <div class="analysis-block">
        <h4>Root Cause</h4>
        <p>${escapeHtml(analysis.cause)}</p>
      </div>
    `;
  }
  
  if (analysis.fix) {
    html += `
      <div class="analysis-block">
        <h4>Suggested Fix</h4>
        <div class="code-block">
          <button class="copy-btn" data-copy="${escapeAttr(analysis.fix)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            Copy Fix
          </button>
          <pre><code>${escapeHtml(analysis.fix)}</code></pre>
        </div>
      </div>
    `;
  }
  
  if (analysis.prevention) {
    html += `
      <div class="analysis-block">
        <h4>Prevention</h4>
        <p>${escapeHtml(analysis.prevention)}</p>
      </div>
    `;
  }
  
  html += '</div>';
  
  return html;
}

/**
 * Set up copy buttons
 */
function setupCopyButtons() {
  const copyBtns = document.querySelectorAll('.copy-btn');
  copyBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = btn.dataset.copy;
      
      try {
        await navigator.clipboard.writeText(text);
        
        // Show success feedback
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Copied!
        `;
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

/**
 * Save settings to storage
 */
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
    
    // Update API key warning
    if (apiKey && apiKey !== 'YOUR_API_KEY_HERE') {
      elements.apiKeyWarning.classList.add('hidden');
    } else {
      elements.apiKeyWarning.classList.remove('hidden');
    }
    
    // Show success feedback
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

/**
 * Update statistics display
 */
function updateStats() {
  const errors = state.errors.filter(e => 
    e.type === 'error' || e.type === 'exception' || e.type === 'network_error'
  ).length;
  
  const warnings = state.errors.filter(e => e.type === 'warning').length;
  const analyzed = state.errors.filter(e => e.status === 'completed').length;
  
  elements.errorCount.textContent = errors;
  elements.warningCount.textContent = warnings;
  elements.analyzedCount.textContent = analyzed;
}

/**
 * Show notification effect
 */
function showNotification() {
  document.body.classList.add('new-error');
  setTimeout(() => {
    document.body.classList.remove('new-error');
  }, 300);
}

/**
 * Get icon for error type
 */
function getTypeIcon(type) {
  switch (type) {
    case 'error':
    case 'exception':
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>`;
    case 'warning':
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>`;
    case 'network_error':
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 12.55a11 11 0 0114.08 0"/>
        <path d="M1.42 9a16 16 0 0121.16 0"/>
        <path d="M8.53 16.11a6 6 0 016.95 0"/>
        <line x1="12" y1="20" x2="12.01" y2="20"/>
      </svg>`;
    case 'promise_rejection':
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M16 16s-1.5-2-4-2-4 2-4 2"/>
        <line x1="9" y1="9" x2="9.01" y2="9"/>
        <line x1="15" y1="9" x2="15.01" y2="9"/>
      </svg>`;
    default:
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>`;
  }
}

/**
 * Get label for error type
 */
function getTypeLabel(type) {
  const labels = {
    'error': 'Console Error',
    'warning': 'Warning',
    'exception': 'Uncaught Exception',
    'network_error': 'Network Error',
    'promise_rejection': 'Promise Rejection'
  };
  return labels[type] || 'Error';
}

/**
 * Get status indicator HTML
 */
function getStatusIndicator(status) {
  switch (status) {
    case 'analyzing':
      return '<div class="status-indicator analyzing"><div class="spinner-small"></div></div>';
    case 'completed':
      return '<div class="status-indicator completed">✓</div>';
    case 'failed':
      return '<div class="status-indicator failed">!</div>';
    default:
      return '<div class="status-indicator pending">•</div>';
  }
}

/**
 * Format timestamp to relative time
 */
function formatTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Truncate text with ellipsis
 */
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Get filename from full path
 */
function getFileName(path) {
  if (!path) return '';
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape for HTML attributes
 */
function escapeAttr(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================
// START
// ============================================

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initialize);
