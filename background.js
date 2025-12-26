/**
 * Debug Buddy - Background Service Worker
 * 
 * This service worker handles:
 * 1. Receiving error messages from content scripts
 * 2. Rate limiting API requests (max 1 per second)
 * 3. Calling Claude API for error analysis
 * 4. Sending results to the side panel
 * 5. Managing extension state and storage
 */

// ============================================
// CONFIGURATION & STATE
// ============================================

const CONFIG = {
  API_ENDPOINT: 'https://api.anthropic.com/v1/messages',
  MODEL: 'claude-sonnet-4-20250514',
  MAX_TOKENS: 1024,
  RATE_LIMIT_MS: 1000, // 1 request per second
  DEFAULT_DOMAINS: ['localhost', '127.0.0.1', '*.local', 'staging.*', '*.staging.*']
};

// Track last API call time for rate limiting
let lastApiCallTime = 0;

// Queue for pending error analyses
const analysisQueue = [];
let isProcessingQueue = false;

// Store for errors and their analyses (in-memory cache)
const errorCache = new Map();

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize extension on install
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Debug Buddy] Extension installed');
  
  // Set default configuration
  const existingConfig = await chrome.storage.sync.get(['apiKey', 'domains', 'enabled']);
  
  if (!existingConfig.domains) {
    await chrome.storage.sync.set({ 
      domains: CONFIG.DEFAULT_DOMAINS,
      enabled: true
    });
  }
  
  // Enable side panel
  await chrome.sidePanel.setOptions({
    enabled: true
  });
});

/**
 * Open side panel when extension icon is clicked
 */
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// ============================================
// MESSAGE HANDLING
// ============================================

/**
 * Listen for messages from content scripts and side panel
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async responses
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

/**
 * Route messages to appropriate handlers
 */
async function handleMessage(message, sender) {
  switch (message.type) {
    case 'ERROR_CAPTURED':
      return await handleErrorCaptured(message.payload, sender);
    
    case 'GET_ERRORS':
      return await getStoredErrors();
    
    case 'ANALYZE_ERROR':
      return await queueErrorAnalysis(message.payload);
    
    case 'CLEAR_ERRORS':
      return await clearErrors();
    
    case 'GET_CONFIG':
      return await getConfig();
    
    case 'CHECK_DOMAIN':
      return await checkDomainAllowed(message.domain);
    
    default:
      console.warn('[Debug Buddy] Unknown message type:', message.type);
      return { success: false, error: 'Unknown message type' };
  }
}

// ============================================
// ERROR HANDLING
// ============================================

/**
 * Handle captured error from content script
 */
async function handleErrorCaptured(errorData, sender) {
  const tabId = sender.tab?.id;
  const tabUrl = sender.tab?.url || '';
  
  // Generate unique ID for this error
  const errorId = generateErrorId(errorData);
  
  // Check if we've already processed this error
  if (errorCache.has(errorId)) {
    console.log('[Debug Buddy] Duplicate error ignored:', errorId);
    return { success: true, duplicate: true };
  }
  
  // Create error record
  const errorRecord = {
    id: errorId,
    ...errorData,
    tabId,
    tabUrl,
    timestamp: Date.now(),
    status: 'pending', // pending, analyzing, completed, failed
    analysis: null
  };
  
  // Store error
  errorCache.set(errorId, errorRecord);
  await saveErrorToStorage(errorRecord);
  
  // Notify side panel of new error
  broadcastToSidePanel({
    type: 'NEW_ERROR',
    payload: errorRecord
  });
  
  // Queue for analysis
  queueErrorAnalysis(errorRecord);
  
  console.log('[Debug Buddy] Error captured:', errorData.message);
  return { success: true, errorId };
}

/**
 * Generate unique ID for an error based on its content
 */
function generateErrorId(errorData) {
  const content = `${errorData.type}-${errorData.message}-${errorData.filename}-${errorData.lineno}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `error_${Math.abs(hash)}_${Date.now()}`;
}

/**
 * Save error to Chrome storage
 */
async function saveErrorToStorage(errorRecord) {
  const { errors = [] } = await chrome.storage.local.get(['errors']);
  
  // Keep only last 100 errors
  const updatedErrors = [errorRecord, ...errors].slice(0, 100);
  
  await chrome.storage.local.set({ errors: updatedErrors });
}

/**
 * Get stored errors from Chrome storage
 */
async function getStoredErrors() {
  const { errors = [] } = await chrome.storage.local.get(['errors']);
  return { success: true, errors };
}

/**
 * Clear all stored errors
 */
async function clearErrors() {
  errorCache.clear();
  await chrome.storage.local.set({ errors: [] });
  
  broadcastToSidePanel({
    type: 'ERRORS_CLEARED'
  });
  
  return { success: true };
}

// ============================================
// API ANALYSIS QUEUE
// ============================================

/**
 * Add error to analysis queue
 */
async function queueErrorAnalysis(errorRecord) {
  analysisQueue.push(errorRecord);
  
  if (!isProcessingQueue) {
    processQueue();
  }
  
  return { success: true, queued: true };
}

/**
 * Process the analysis queue with rate limiting
 */
async function processQueue() {
  if (isProcessingQueue || analysisQueue.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  
  while (analysisQueue.length > 0) {
    const errorRecord = analysisQueue.shift();
    
    // Enforce rate limiting
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCallTime;
    
    if (timeSinceLastCall < CONFIG.RATE_LIMIT_MS) {
      const waitTime = CONFIG.RATE_LIMIT_MS - timeSinceLastCall;
      await sleep(waitTime);
    }
    
    // Perform analysis
    await analyzeError(errorRecord);
    lastApiCallTime = Date.now();
  }
  
  isProcessingQueue = false;
}

/**
 * Analyze error using Claude API
 */
async function analyzeError(errorRecord) {
  // Update status to analyzing
  errorRecord.status = 'analyzing';
  await updateErrorInStorage(errorRecord);
  
  broadcastToSidePanel({
    type: 'ERROR_STATUS_UPDATED',
    payload: { id: errorRecord.id, status: 'analyzing' }
  });
  
  try {
    // Get API key from storage
    const { apiKey } = await chrome.storage.sync.get(['apiKey']);
    
    if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
      throw new Error('API key not configured. Please add your Anthropic API key in settings.');
    }
    
    // Build the prompt
    const prompt = buildAnalysisPrompt(errorRecord);
    
    // Call Claude API
    const response = await fetch(CONFIG.API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CONFIG.MODEL,
        max_tokens: CONFIG.MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    const analysisText = data.content[0]?.text || 'No analysis available';
    
    // Parse the analysis response
    const analysis = parseAnalysisResponse(analysisText);
    
    // Update error record with analysis
    errorRecord.status = 'completed';
    errorRecord.analysis = analysis;
    errorCache.set(errorRecord.id, errorRecord);
    await updateErrorInStorage(errorRecord);
    
    // Notify side panel
    broadcastToSidePanel({
      type: 'ANALYSIS_COMPLETED',
      payload: errorRecord
    });
    
    console.log('[Debug Buddy] Analysis completed for:', errorRecord.id);
    
  } catch (error) {
    console.error('[Debug Buddy] Analysis failed:', error);
    
    errorRecord.status = 'failed';
    errorRecord.analysis = {
      error: error.message,
      explanation: 'Failed to analyze error. Please check your API key and try again.',
      fix: null,
      severity: 'unknown'
    };
    
    errorCache.set(errorRecord.id, errorRecord);
    await updateErrorInStorage(errorRecord);
    
    broadcastToSidePanel({
      type: 'ANALYSIS_FAILED',
      payload: { id: errorRecord.id, error: error.message }
    });
  }
}

/**
 * Build the prompt for Claude API
 */
function buildAnalysisPrompt(errorRecord) {
  return `You are an expert JavaScript debugging assistant. Analyze the following browser console error and provide a helpful explanation and fix.

ERROR DETAILS:
- Type: ${errorRecord.type}
- Message: ${errorRecord.message}
- File: ${errorRecord.filename || 'Unknown'}
- Line: ${errorRecord.lineno || 'Unknown'}
- Column: ${errorRecord.colno || 'Unknown'}
- URL: ${errorRecord.tabUrl || 'Unknown'}

STACK TRACE:
${errorRecord.stack || 'No stack trace available'}

Please respond in the following JSON format:
{
  "severity": "low|medium|high|critical",
  "explanation": "Clear explanation of what caused this error",
  "cause": "The specific reason this error occurred",
  "fix": "Code snippet or solution to fix this error",
  "prevention": "How to prevent this error in the future"
}

Keep explanations concise but helpful. If you include code in the "fix" field, make it copy-paste ready.`;
}

/**
 * Parse the analysis response from Claude
 */
function parseAnalysisResponse(responseText) {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn('[Debug Buddy] Failed to parse JSON response, using raw text');
  }
  
  // Fallback to raw text
  return {
    severity: 'medium',
    explanation: responseText,
    cause: '',
    fix: '',
    prevention: ''
  };
}

/**
 * Update error in Chrome storage
 */
async function updateErrorInStorage(errorRecord) {
  const { errors = [] } = await chrome.storage.local.get(['errors']);
  
  const updatedErrors = errors.map(e => 
    e.id === errorRecord.id ? errorRecord : e
  );
  
  await chrome.storage.local.set({ errors: updatedErrors });
}

// ============================================
// DOMAIN CHECKING
// ============================================

/**
 * Check if a domain is in the whitelist
 */
async function checkDomainAllowed(domain) {
  const { domains = CONFIG.DEFAULT_DOMAINS, enabled = true } = await chrome.storage.sync.get(['domains', 'enabled']);
  
  if (!enabled) {
    return { allowed: false, reason: 'Extension disabled' };
  }
  
  const isAllowed = domains.some(pattern => matchDomainPattern(domain, pattern));
  
  return { allowed: isAllowed };
}

/**
 * Match domain against a pattern (supports wildcards)
 */
function matchDomainPattern(domain, pattern) {
  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*');
  
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(domain);
}

/**
 * Get current configuration
 */
async function getConfig() {
  const config = await chrome.storage.sync.get(['apiKey', 'domains', 'enabled']);
  
  return {
    success: true,
    config: {
      apiKey: config.apiKey ? '****' + config.apiKey.slice(-4) : null,
      hasApiKey: !!config.apiKey && config.apiKey !== 'YOUR_API_KEY_HERE',
      domains: config.domains || CONFIG.DEFAULT_DOMAINS,
      enabled: config.enabled !== false
    }
  };
}

// ============================================
// UTILITIES
// ============================================

/**
 * Broadcast message to side panel
 */
function broadcastToSidePanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel might not be open, ignore error
  });
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('[Debug Buddy] Background service worker initialized');
