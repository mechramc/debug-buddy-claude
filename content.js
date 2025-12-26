/**
 * Debug Buddy - Content Script
 * 
 * This script is injected into every web page and handles:
 * 1. Intercepting console.error and console.warn
 * 2. Capturing uncaught exceptions (window.onerror)
 * 3. Capturing unhandled promise rejections
 * 4. Filtering by domain whitelist
 * 5. Sending captured errors to the background service worker
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================

  const DEBUG_BUDDY_PREFIX = '[Debug Buddy]';
  
  // Prevent multiple injections
  if (window.__debugBuddyInjected) {
    return;
  }
  window.__debugBuddyInjected = true;

  // Track if extension is enabled for this domain
  let isEnabledForDomain = false;

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Initialize the content script
   */
  async function initialize() {
    // Check if this domain is in the whitelist
    const domain = window.location.hostname;
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_DOMAIN',
        domain: domain
      });
      
      isEnabledForDomain = response?.allowed || false;
      
      if (isEnabledForDomain) {
        console.log(`${DEBUG_BUDDY_PREFIX} Monitoring enabled for ${domain}`);
        setupErrorCapture();
      } else {
        console.log(`${DEBUG_BUDDY_PREFIX} Monitoring disabled for ${domain} (not in whitelist)`);
      }
    } catch (error) {
      // Extension context might be invalid (e.g., during reload)
      console.warn(`${DEBUG_BUDDY_PREFIX} Could not connect to extension`);
    }
  }

  // ============================================
  // ERROR CAPTURE SETUP
  // ============================================

  /**
   * Set up all error capture mechanisms
   */
  function setupErrorCapture() {
    interceptConsole();
    captureWindowErrors();
    capturePromiseRejections();
  }

  /**
   * Intercept console.error and console.warn
   */
  function interceptConsole() {
    // Store original console methods
    const originalError = console.error;
    const originalWarn = console.warn;

    // Override console.error
    console.error = function(...args) {
      // Call original first
      originalError.apply(console, args);
      
      // Capture the error
      captureConsoleError('error', args);
    };

    // Override console.warn
    console.warn = function(...args) {
      // Call original first
      originalWarn.apply(console, args);
      
      // Capture the warning
      captureConsoleError('warning', args);
    };
  }

  /**
   * Capture console.error and console.warn calls
   */
  function captureConsoleError(type, args) {
    // Don't capture our own logs
    if (args[0]?.toString().startsWith(DEBUG_BUDDY_PREFIX)) {
      return;
    }

    // Build error message from arguments
    const message = args.map(arg => {
      if (arg instanceof Error) {
        return arg.message;
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    // Try to get stack trace
    let stack = '';
    const errorArg = args.find(arg => arg instanceof Error);
    if (errorArg) {
      stack = errorArg.stack || '';
    } else {
      // Generate a stack trace
      stack = new Error().stack || '';
      // Remove the first few lines (our own code)
      const lines = stack.split('\n');
      stack = lines.slice(3).join('\n');
    }

    // Parse location from stack
    const location = parseStackLocation(stack);

    sendErrorToBackground({
      type: type,
      message: message,
      stack: stack,
      filename: location.filename,
      lineno: location.lineno,
      colno: location.colno
    });
  }

  /**
   * Capture uncaught JavaScript errors
   */
  function captureWindowErrors() {
    window.addEventListener('error', (event) => {
      // Ignore errors from extensions or cross-origin scripts
      if (!event.filename || event.filename.startsWith('chrome-extension://')) {
        return;
      }

      sendErrorToBackground({
        type: 'exception',
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack || ''
      });
    }, true);
  }

  /**
   * Capture unhandled promise rejections
   */
  function capturePromiseRejections() {
    window.addEventListener('unhandledrejection', (event) => {
      let message = 'Unhandled Promise Rejection';
      let stack = '';

      if (event.reason instanceof Error) {
        message = event.reason.message;
        stack = event.reason.stack || '';
      } else if (typeof event.reason === 'string') {
        message = event.reason;
      } else if (event.reason) {
        try {
          message = JSON.stringify(event.reason);
        } catch {
          message = String(event.reason);
        }
      }

      const location = parseStackLocation(stack);

      sendErrorToBackground({
        type: 'promise_rejection',
        message: message,
        stack: stack,
        filename: location.filename,
        lineno: location.lineno,
        colno: location.colno
      });
    });
  }

  // ============================================
  // UTILITIES
  // ============================================

  /**
   * Parse filename, line number, and column from stack trace
   */
  function parseStackLocation(stack) {
    if (!stack) {
      return { filename: '', lineno: 0, colno: 0 };
    }

    // Try to match common stack trace formats
    // Chrome: "    at functionName (filename:line:col)"
    // Firefox: "functionName@filename:line:col"
    const patterns = [
      /at\s+(?:\S+\s+)?\(?(https?:\/\/[^:]+|[^:]+):(\d+):(\d+)\)?/,
      /at\s+(https?:\/\/[^:]+|[^:]+):(\d+):(\d+)/,
      /@(https?:\/\/[^:]+|[^:]+):(\d+):(\d+)/
    ];

    const lines = stack.split('\n');
    
    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          return {
            filename: match[1],
            lineno: parseInt(match[2], 10),
            colno: parseInt(match[3], 10)
          };
        }
      }
    }

    return { filename: '', lineno: 0, colno: 0 };
  }

  /**
   * Send captured error to background service worker
   */
  function sendErrorToBackground(errorData) {
    // Add timestamp and URL
    const enrichedError = {
      ...errorData,
      url: window.location.href,
      timestamp: Date.now(),
      userAgent: navigator.userAgent
    };

    try {
      chrome.runtime.sendMessage({
        type: 'ERROR_CAPTURED',
        payload: enrichedError
      }).catch((error) => {
        // Extension context might be invalid
        console.warn(`${DEBUG_BUDDY_PREFIX} Could not send error to extension:`, error);
      });
    } catch (error) {
      // Extension might not be available
      console.warn(`${DEBUG_BUDDY_PREFIX} Extension not available`);
    }
  }

  // ============================================
  // NETWORK ERROR MONITORING
  // ============================================

  /**
   * Monitor fetch requests for errors
   */
  function setupFetchMonitoring() {
    const originalFetch = window.fetch;

    window.fetch = async function(...args) {
      try {
        const response = await originalFetch.apply(this, args);
        
        // Capture failed HTTP responses (4xx, 5xx)
        if (!response.ok) {
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || 'unknown';
          
          sendErrorToBackground({
            type: 'network_error',
            message: `HTTP ${response.status}: ${response.statusText} - ${url}`,
            filename: url,
            lineno: 0,
            colno: 0,
            stack: new Error().stack || ''
          });
        }
        
        return response;
      } catch (error) {
        // Capture network failures
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || 'unknown';
        
        sendErrorToBackground({
          type: 'network_error',
          message: `Fetch failed: ${error.message} - ${url}`,
          filename: url,
          lineno: 0,
          colno: 0,
          stack: error.stack || ''
        });
        
        throw error;
      }
    };
  }

  /**
   * Monitor XMLHttpRequest for errors
   */
  function setupXHRMonitoring() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this._debugBuddyUrl = url;
      this._debugBuddyMethod = method;
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
      this.addEventListener('error', () => {
        sendErrorToBackground({
          type: 'network_error',
          message: `XHR failed: ${this._debugBuddyMethod} ${this._debugBuddyUrl}`,
          filename: this._debugBuddyUrl,
          lineno: 0,
          colno: 0,
          stack: new Error().stack || ''
        });
      });

      this.addEventListener('load', () => {
        if (this.status >= 400) {
          sendErrorToBackground({
            type: 'network_error',
            message: `HTTP ${this.status}: ${this.statusText} - ${this._debugBuddyMethod} ${this._debugBuddyUrl}`,
            filename: this._debugBuddyUrl,
            lineno: 0,
            colno: 0,
            stack: ''
          });
        }
      });

      return originalSend.apply(this, args);
    };
  }

  // ============================================
  // START
  // ============================================

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  // Also set up network monitoring (runs immediately)
  setupFetchMonitoring();
  setupXHRMonitoring();

})();
