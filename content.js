/**
 * Debug Buddy - Content Script (Enhanced)
 * 
 * Captures errors from:
 * 1. CONSOLE: console.error, console.warn, deprecation warnings
 * 2. NETWORK: Failed fetches, XHR errors, slow requests, 4xx/5xx responses
 * 3. ELEMENTS/DOM: DOM exceptions, mutation errors, invalid HTML
 * 4. JAVASCRIPT: Uncaught exceptions, promise rejections
 * 5. PERFORMANCE: Long tasks, resource loading failures
 * 6. CSP: Content Security Policy violations
 */

(function() {
  'use strict';

  const DEBUG_BUDDY_PREFIX = '[Debug Buddy]';
  
  // Prevent multiple injections
  if (window.__debugBuddyInjected) {
    return;
  }
  window.__debugBuddyInjected = true;

  // Configuration
  const CONFIG = {
    SLOW_REQUEST_THRESHOLD: 5000,  // 5 seconds
    LONG_TASK_THRESHOLD: 50,       // 50ms (standard long task)
    MAX_ERRORS_PER_MINUTE: 50,     // Rate limit to prevent spam
    DEBOUNCE_MS: 100               // Debounce duplicate errors
  };

  // State
  let isEnabledForDomain = false;
  let errorCount = 0;
  let lastErrorReset = Date.now();
  const recentErrors = new Map();

  // ============================================
  // INITIALIZATION
  // ============================================

  async function initialize() {
    const domain = window.location.hostname;
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_DOMAIN',
        domain: domain
      });
      
      isEnabledForDomain = response?.allowed || false;
      
      if (isEnabledForDomain) {
        console.log(`${DEBUG_BUDDY_PREFIX} Monitoring enabled for ${domain}`);
        setupAllCapture();
      } else {
        console.log(`${DEBUG_BUDDY_PREFIX} Monitoring disabled for ${domain}`);
      }
    } catch (error) {
      console.warn(`${DEBUG_BUDDY_PREFIX} Could not connect to extension`);
    }
  }

  function setupAllCapture() {
    interceptConsole();
    captureWindowErrors();
    capturePromiseRejections();
    setupFetchMonitoring();
    setupXHRMonitoring();
    setupDOMErrorCapture();
    setupMutationObserver();
    setupPerformanceMonitoring();
    setupResourceErrorCapture();
    setupCSPCapture();
    setupReportingObserver();
  }

  // ============================================
  // CONSOLE CAPTURE
  // ============================================

  function interceptConsole() {
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = function(...args) {
      originalError.apply(console, args);
      captureConsoleMessage('error', args);
    };

    console.warn = function(...args) {
      originalWarn.apply(console, args);
      captureConsoleMessage('warning', args);
    };
  }

  function captureConsoleMessage(type, args) {
    if (args[0]?.toString().startsWith(DEBUG_BUDDY_PREFIX)) {
      return;
    }

    const message = args.map(arg => {
      if (arg instanceof Error) return arg.message;
      if (typeof arg === 'object') {
        try { return JSON.stringify(arg, null, 2); }
        catch { return String(arg); }
      }
      return String(arg);
    }).join(' ');

    let stack = '';
    const errorArg = args.find(arg => arg instanceof Error);
    if (errorArg) {
      stack = errorArg.stack || '';
    } else {
      stack = new Error().stack || '';
      const lines = stack.split('\n');
      stack = lines.slice(3).join('\n');
    }

    const location = parseStackLocation(stack);
    const category = categorizeConsoleMessage(message);

    sendErrorToBackground({
      type: type,
      category: category,
      message: message,
      stack: stack,
      filename: location.filename,
      lineno: location.lineno,
      colno: location.colno,
      source: 'console'
    });
  }

  function categorizeConsoleMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('deprecat')) return 'deprecation';
    if (lowerMessage.includes('csp') || lowerMessage.includes('content security policy')) return 'csp';
    if (lowerMessage.includes('cors') || lowerMessage.includes('cross-origin')) return 'cors';
    if (lowerMessage.includes('failed to fetch') || lowerMessage.includes('network')) return 'network';
    if (lowerMessage.includes('syntaxerror')) return 'syntax';
    if (lowerMessage.includes('typeerror')) return 'type';
    if (lowerMessage.includes('referenceerror') || lowerMessage.includes('is not defined')) return 'reference';
    if (lowerMessage.includes('permission') || lowerMessage.includes('denied')) return 'permission';
    
    return 'general';
  }

  // ============================================
  // JAVASCRIPT ERROR CAPTURE
  // ============================================

  function captureWindowErrors() {
    window.addEventListener('error', (event) => {
      if (!event.filename || event.filename.startsWith('chrome-extension://')) {
        return;
      }

      if (event.target && (event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK' || event.target.tagName === 'IMG')) {
        return;
      }

      sendErrorToBackground({
        type: 'exception',
        category: 'javascript',
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack || '',
        source: 'window.onerror'
      });
    }, true);
  }

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
        try { message = JSON.stringify(event.reason); }
        catch { message = String(event.reason); }
      }

      const location = parseStackLocation(stack);

      sendErrorToBackground({
        type: 'promise_rejection',
        category: 'javascript',
        message: message,
        stack: stack,
        filename: location.filename,
        lineno: location.lineno,
        colno: location.colno,
        source: 'unhandledrejection'
      });
    });
  }

  // ============================================
  // NETWORK MONITORING
  // ============================================

  function setupFetchMonitoring() {
    const originalFetch = window.fetch;

    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || 'unknown';
      const method = args[1]?.method || 'GET';
      const startTime = performance.now();

      try {
        const response = await originalFetch.apply(this, args);
        const duration = performance.now() - startTime;

        if (duration > CONFIG.SLOW_REQUEST_THRESHOLD) {
          sendErrorToBackground({
            type: 'network_slow',
            category: 'performance',
            message: `Slow request: ${method} ${url} took ${Math.round(duration)}ms`,
            filename: url,
            lineno: 0,
            colno: 0,
            stack: '',
            source: 'fetch',
            metadata: { method, url, duration: Math.round(duration), status: response.status }
          });
        }

        if (!response.ok) {
          sendErrorToBackground({
            type: 'network_error',
            category: 'network',
            message: `HTTP ${response.status} ${response.statusText}: ${method} ${url}`,
            filename: url,
            lineno: 0,
            colno: 0,
            stack: new Error().stack || '',
            source: 'fetch',
            metadata: { method, url, status: response.status, statusText: response.statusText, duration: Math.round(duration) }
          });
        }

        return response;
      } catch (error) {
        const duration = performance.now() - startTime;

        sendErrorToBackground({
          type: 'network_error',
          category: 'network',
          message: `Fetch failed: ${error.message} - ${method} ${url}`,
          filename: url,
          lineno: 0,
          colno: 0,
          stack: error.stack || '',
          source: 'fetch',
          metadata: { method, url, error: error.message, duration: Math.round(duration) }
        });

        throw error;
      }
    };
  }

  function setupXHRMonitoring() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this._debugBuddyUrl = url;
      this._debugBuddyMethod = method;
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
      const startTime = performance.now();

      this.addEventListener('error', () => {
        sendErrorToBackground({
          type: 'network_error',
          category: 'network',
          message: `XHR failed: ${this._debugBuddyMethod} ${this._debugBuddyUrl}`,
          filename: this._debugBuddyUrl,
          lineno: 0,
          colno: 0,
          stack: new Error().stack || '',
          source: 'xhr',
          metadata: { method: this._debugBuddyMethod, url: this._debugBuddyUrl }
        });
      });

      this.addEventListener('timeout', () => {
        sendErrorToBackground({
          type: 'network_timeout',
          category: 'network',
          message: `XHR timeout: ${this._debugBuddyMethod} ${this._debugBuddyUrl}`,
          filename: this._debugBuddyUrl,
          lineno: 0,
          colno: 0,
          stack: '',
          source: 'xhr',
          metadata: { method: this._debugBuddyMethod, url: this._debugBuddyUrl, timeout: this.timeout }
        });
      });

      this.addEventListener('load', () => {
        const duration = performance.now() - startTime;

        if (duration > CONFIG.SLOW_REQUEST_THRESHOLD) {
          sendErrorToBackground({
            type: 'network_slow',
            category: 'performance',
            message: `Slow XHR: ${this._debugBuddyMethod} ${this._debugBuddyUrl} took ${Math.round(duration)}ms`,
            filename: this._debugBuddyUrl,
            lineno: 0,
            colno: 0,
            stack: '',
            source: 'xhr',
            metadata: { method: this._debugBuddyMethod, url: this._debugBuddyUrl, duration: Math.round(duration), status: this.status }
          });
        }

        if (this.status >= 400) {
          sendErrorToBackground({
            type: 'network_error',
            category: 'network',
            message: `HTTP ${this.status}: ${this._debugBuddyMethod} ${this._debugBuddyUrl}`,
            filename: this._debugBuddyUrl,
            lineno: 0,
            colno: 0,
            stack: '',
            source: 'xhr',
            metadata: { method: this._debugBuddyMethod, url: this._debugBuddyUrl, status: this.status, statusText: this.statusText, duration: Math.round(duration) }
          });
        }
      });

      return originalSend.apply(this, args);
    };
  }

  // ============================================
  // DOM/ELEMENTS ERROR CAPTURE
  // ============================================

  function setupDOMErrorCapture() {
    const originalQuerySelector = document.querySelector;
    const originalQuerySelectorAll = document.querySelectorAll;

    document.querySelector = function(selector) {
      try {
        return originalQuerySelector.call(this, selector);
      } catch (error) {
        sendErrorToBackground({
          type: 'dom_error',
          category: 'dom',
          message: `Invalid selector: "${selector}" - ${error.message}`,
          filename: window.location.href,
          lineno: 0,
          colno: 0,
          stack: error.stack || '',
          source: 'querySelector'
        });
        throw error;
      }
    };

    document.querySelectorAll = function(selector) {
      try {
        return originalQuerySelectorAll.call(this, selector);
      } catch (error) {
        sendErrorToBackground({
          type: 'dom_error',
          category: 'dom',
          message: `Invalid selector: "${selector}" - ${error.message}`,
          filename: window.location.href,
          lineno: 0,
          colno: 0,
          stack: error.stack || '',
          source: 'querySelectorAll'
        });
        throw error;
      }
    };
  }

  function setupMutationObserver() {
    const dangerousMethods = ['insertBefore', 'appendChild', 'removeChild', 'replaceChild'];
    
    dangerousMethods.forEach(methodName => {
      const original = Node.prototype[methodName];
      Node.prototype[methodName] = function(...args) {
        try {
          return original.apply(this, args);
        } catch (error) {
          sendErrorToBackground({
            type: 'dom_error',
            category: 'dom',
            message: `DOM manipulation error in ${methodName}: ${error.message}`,
            filename: window.location.href,
            lineno: 0,
            colno: 0,
            stack: error.stack || '',
            source: `Node.${methodName}`
          });
          throw error;
        }
      };
    });

    const originalInnerHTMLDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (originalInnerHTMLDescriptor && originalInnerHTMLDescriptor.set) {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        set: function(value) {
          try {
            return originalInnerHTMLDescriptor.set.call(this, value);
          } catch (error) {
            sendErrorToBackground({
              type: 'dom_error',
              category: 'dom',
              message: `innerHTML error: ${error.message}`,
              filename: window.location.href,
              lineno: 0,
              colno: 0,
              stack: error.stack || '',
              source: 'innerHTML'
            });
            throw error;
          }
        },
        get: originalInnerHTMLDescriptor.get,
        configurable: true
      });
    }
  }

  // ============================================
  // PERFORMANCE MONITORING
  // ============================================

  function setupPerformanceMonitoring() {
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > CONFIG.LONG_TASK_THRESHOLD) {
              sendErrorToBackground({
                type: 'performance_longtask',
                category: 'performance',
                message: `Long task detected: ${Math.round(entry.duration)}ms blocking the main thread`,
                filename: entry.attribution?.[0]?.containerSrc || window.location.href,
                lineno: 0,
                colno: 0,
                stack: '',
                source: 'PerformanceObserver',
                metadata: { duration: Math.round(entry.duration), startTime: Math.round(entry.startTime), attribution: entry.attribution?.[0]?.name || 'unknown' }
              });
            }
          }
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      } catch (e) {}

      try {
        const clsObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.value > 0.1) {
              sendErrorToBackground({
                type: 'performance_cls',
                category: 'performance',
                message: `Layout shift detected: ${entry.value.toFixed(3)} CLS score`,
                filename: window.location.href,
                lineno: 0,
                colno: 0,
                stack: '',
                source: 'PerformanceObserver',
                metadata: { value: entry.value, hadRecentInput: entry.hadRecentInput }
              });
            }
          }
        });
        clsObserver.observe({ entryTypes: ['layout-shift'] });
      } catch (e) {}
    }
  }

  function setupResourceErrorCapture() {
    window.addEventListener('error', (event) => {
      const target = event.target;
      
      if (target && target !== window) {
        let resourceType = 'unknown';
        let url = '';

        if (target.tagName === 'SCRIPT') { resourceType = 'script'; url = target.src; }
        else if (target.tagName === 'LINK') { resourceType = 'stylesheet'; url = target.href; }
        else if (target.tagName === 'IMG') { resourceType = 'image'; url = target.src; }
        else if (target.tagName === 'VIDEO' || target.tagName === 'AUDIO') { resourceType = 'media'; url = target.src || target.currentSrc; }
        else if (target.tagName === 'IFRAME') { resourceType = 'iframe'; url = target.src; }

        if (url) {
          sendErrorToBackground({
            type: 'resource_error',
            category: 'network',
            message: `Failed to load ${resourceType}: ${url}`,
            filename: url,
            lineno: 0,
            colno: 0,
            stack: '',
            source: `${target.tagName.toLowerCase()}.onerror`,
            metadata: { resourceType, url, tagName: target.tagName }
          });
        }
      }
    }, true);
  }

  // ============================================
  // CSP VIOLATION CAPTURE
  // ============================================

  function setupCSPCapture() {
    document.addEventListener('securitypolicyviolation', (event) => {
      sendErrorToBackground({
        type: 'csp_violation',
        category: 'csp',
        message: `CSP violation: ${event.violatedDirective} - blocked ${event.blockedURI}`,
        filename: event.sourceFile || window.location.href,
        lineno: event.lineNumber || 0,
        colno: event.columnNumber || 0,
        stack: '',
        source: 'securitypolicyviolation',
        metadata: { violatedDirective: event.violatedDirective, effectiveDirective: event.effectiveDirective, blockedURI: event.blockedURI, originalPolicy: event.originalPolicy, disposition: event.disposition }
      });
    });
  }

  // ============================================
  // REPORTING OBSERVER (Deprecations)
  // ============================================

  function setupReportingObserver() {
    if (typeof ReportingObserver !== 'undefined') {
      try {
        const reportingObserver = new ReportingObserver((reports) => {
          for (const report of reports) {
            const body = report.body;
            
            if (report.type === 'deprecation') {
              sendErrorToBackground({
                type: 'deprecation',
                category: 'deprecation',
                message: `Deprecated: ${body.message || body.id}`,
                filename: body.sourceFile || window.location.href,
                lineno: body.lineNumber || 0,
                colno: body.columnNumber || 0,
                stack: '',
                source: 'ReportingObserver',
                metadata: { id: body.id, anticipatedRemoval: body.anticipatedRemoval }
              });
            } else if (report.type === 'intervention') {
              sendErrorToBackground({
                type: 'intervention',
                category: 'intervention',
                message: `Browser intervention: ${body.message || body.id}`,
                filename: body.sourceFile || window.location.href,
                lineno: body.lineNumber || 0,
                colno: body.columnNumber || 0,
                stack: '',
                source: 'ReportingObserver',
                metadata: { id: body.id }
              });
            }
          }
        }, { buffered: true });
        reportingObserver.observe();
      } catch (e) {}
    }
  }

  // ============================================
  // UTILITIES
  // ============================================

  function parseStackLocation(stack) {
    if (!stack) return { filename: '', lineno: 0, colno: 0 };

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
          return { filename: match[1], lineno: parseInt(match[2], 10), colno: parseInt(match[3], 10) };
        }
      }
    }

    return { filename: '', lineno: 0, colno: 0 };
  }

  function sendErrorToBackground(errorData) {
    const now = Date.now();
    if (now - lastErrorReset > 60000) {
      errorCount = 0;
      lastErrorReset = now;
    }
    
    if (errorCount >= CONFIG.MAX_ERRORS_PER_MINUTE) return;

    const errorKey = `${errorData.type}:${errorData.message}:${errorData.filename}`;
    const lastSent = recentErrors.get(errorKey);
    
    if (lastSent && (now - lastSent) < CONFIG.DEBOUNCE_MS) return;
    
    recentErrors.set(errorKey, now);
    errorCount++;

    if (recentErrors.size > 100) {
      const cutoff = now - 10000;
      for (const [key, time] of recentErrors) {
        if (time < cutoff) recentErrors.delete(key);
      }
    }

    const enrichedError = {
      ...errorData,
      url: window.location.href,
      timestamp: now,
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };

    try {
      chrome.runtime.sendMessage({
        type: 'ERROR_CAPTURED',
        payload: enrichedError
      }).catch(() => {});
    } catch (error) {}
  }

  // ============================================
  // START
  // ============================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

})();
