class GraphQLTracker {
  constructor() {
    this.requests = [];
    this.selectedRequestId = null;
    this.activeTab = 'query';
    this.collapsedBatches = new Set();
    this.filterText = '';
    this.preserveLog = localStorage.getItem('preserveLog') === 'true';
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.startMonitoring();
    this.updateRequestCount();
  }

  setupEventListeners() {
    document.getElementById('clearBtn')?.addEventListener('click', () => this.clearRequests());
    
    // Search input listener
    const searchInput = document.getElementById('searchInput');
    searchInput?.addEventListener('input', (e) => {
      this.filterText = e.target.value;
      this.renderRequestList();
    });
    
    // Clear search button listener
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    clearSearchBtn?.addEventListener('click', () => {
      this.filterText = '';
      searchInput.value = '';
      this.renderRequestList();
    });
    
    // Preserve log checkbox listener
    const preserveLogCheckbox = document.getElementById('preserveLogCheckbox');
    preserveLogCheckbox?.addEventListener('change', (e) => {
      this.preserveLog = e.target.checked;
      localStorage.setItem('preserveLog', this.preserveLog ? 'true' : 'false');
    });
    
    // Set initial checkbox state
    if (preserveLogCheckbox) {
      preserveLogCheckbox.checked = this.preserveLog;
    }
  }

  startMonitoring() {
    if (!chrome.devtools?.network) return;
    chrome.devtools.network.onRequestFinished.addListener((request) => {
      this.onRequestFinished(request);
    });
    chrome.devtools.network.onNavigated.addListener(() => {
      if (!this.preserveLog) {
        this.clearRequests();
      }
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  isGraphQLRequest(request) {
    const url = request.request.url.toLowerCase();
    const method = request.request.method;
    
    if (method !== 'POST') return false;

    try {
      const postData = request.request.postData?.text;
      if (!postData) return false;

      const parsed = JSON.parse(postData);

      // Batch request: array of GraphQL operations
      if (Array.isArray(parsed)) {
        return parsed.length > 0 && this.looksLikeGraphQLOperation(parsed[0]);
      }

      // Single GraphQL operation
      if (this.looksLikeGraphQLOperation(parsed)) return true;
    } catch (e) {}

    // Fallback: URL-based heuristic only (no body check)
    return url.includes('graphql');
  }

  looksLikeGraphQLOperation(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const query = obj.query;
    if (typeof query !== 'string') return false;
    // The query value must start with a GraphQL operation keyword or shorthand
    const trimmed = query.trim();
    return /^(query|mutation|subscription|fragment|\{)[\s\S]/.test(trimmed);
  }

  isBatchRequest(postData) {
    try {
      const parsed = JSON.parse(postData);
      return Array.isArray(parsed) && parsed.length > 0 && this.looksLikeGraphQLOperation(parsed[0]);
    } catch (e) {
      return false;
    }
  }

  getOperationType(query) {
    if (query.trim().startsWith('mutation')) return 'mutation';
    if (query.trim().startsWith('subscription')) return 'subscription';
    return 'query';
  }

  onRequestFinished(request) {
    if (!this.isGraphQLRequest(request)) return;

    const postDataText = request.request.postData?.text || '';
    const isBatch = this.isBatchRequest(postDataText);
    const batchId = isBatch ? `batch-${Date.now()}-${Math.random()}` : null;
    const timestamp = new Date().toLocaleTimeString();
    const url = request.request.url;
    const method = request.request.method;
    const status = request.response.status;
    
    // Extract headers
    const requestHeaders = request.request.headers || {};
    const responseHeaders = request.response.headers || {};

    request.getContent((content) => {
      let responseData = {};
      try {
        if (content) responseData = JSON.parse(content);
      } catch (e) {
        responseData = { rawContent: content || 'No content' };
      }

      if (isBatch) {
        // Parse batch request
        const operations = JSON.parse(postDataText);
        const responses = Array.isArray(responseData) ? responseData : [];
        const batchSize = operations.length;

        // Create child requests for each operation
        operations.forEach((op, index) => {
          const query = op.query || '';
          const variables = op.variables || {};
          const opResponse = responses[index] || {};
          const hasErrors = !!(opResponse.errors && opResponse.errors.length > 0);

          this.requests.unshift({
            id: Date.now() + Math.random() + index,
            url,
            method,
            query,
            variables,
            response: opResponse,
            operationType: this.getOperationType(query),
            operationName: op.operationName || this.extractOperationName(query),
            timestamp,
            status,
            // Headers
            requestHeaders,
            responseHeaders,
            // Batch-specific fields
            batchId,
            batchIndex: index,
            batchSize,
            isFirstInBatch: index === 0,
            isLastInBatch: index === batchSize - 1,
            // Error tracking
            hasErrors,
            errors: opResponse.errors || null
          });
        });
      } else {
        // Single request (existing logic)
        let query = '';
        let variables = {};
        
        try {
          const postData = JSON.parse(postDataText);
          query = postData.query || '';
          variables = postData.variables || {};
        } catch (e) {
          query = postDataText;
        }

        const hasErrors = !!(responseData.errors && responseData.errors.length > 0);

        this.requests.unshift({
          id: Date.now() + Math.random(),
          url,
          method,
          query,
          variables,
          response: responseData,
          operationType: this.getOperationType(query),
          operationName: this.extractOperationName(query),
          timestamp,
          status,
          // Headers
          requestHeaders,
          responseHeaders,
          // Non-batch
          batchId: null,
          batchIndex: null,
          batchSize: null,
          isFirstInBatch: false,
          isLastInBatch: false,
          // Error tracking
          hasErrors,
          errors: responseData.errors || null
        });
      }

      this.updateRequestCount();
      this.renderRequestList();
    });
  }

  extractOperationName(query) {
    const match = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
    return match ? match[1] : null;
  }

  updateRequestCount() {
    const countEl = document.getElementById('requestCount');
    if (countEl) countEl.textContent = `${this.requests.length}`;
  }

  getFilteredRequests() {
    if (!this.filterText) return this.requests;
    
    const term = this.filterText.toLowerCase();
    return this.requests.filter(req => 
      req.operationName?.toLowerCase().includes(term) ||
      req.query?.toLowerCase().includes(term) ||
      req.url?.toLowerCase().includes(term)
    );
  }

  renderRequestList() {
    const listContainer = document.getElementById('requestList');
    
    const filteredRequests = this.getFilteredRequests();
    
    // Get or create items container
    let itemsContainer = listContainer.querySelector('.request-list-container');
    if (!itemsContainer) {
      itemsContainer = document.createElement('div');
      itemsContainer.className = 'request-list-container';
      listContainer.appendChild(itemsContainer);
    }
    
    if (filteredRequests.length === 0) {
      itemsContainer.innerHTML = `<div class="empty-state">${this.filterText ? 'No requests match filter' : 'Waiting for GraphQL requests...'}</div>`;
      return;
    }

    // Group requests by batchId for rendering
    let html = '';
    let processedBatches = new Set();

    filteredRequests.forEach((req, idx) => {
      if (req.batchId) {
        // Batch request
        if (processedBatches.has(req.batchId)) return;
        processedBatches.add(req.batchId);

        const batchRequests = filteredRequests.filter(r => r.batchId === req.batchId);
        batchRequests.sort((a, b) => a.batchIndex - b.batchIndex);
        
        const isCollapsed = this.collapsedBatches.has(req.batchId);
        const firstReq = batchRequests[0];
        const hasAnyErrors = batchRequests.some(r => r.hasErrors);

        html += `
          <div class="batch-group ${isCollapsed ? 'collapsed' : ''}" data-batch-id="${req.batchId}">
            <div class="batch-header-container" data-batch-id="${req.batchId}" data-first-id="${firstReq.id}">
              <div class="batch-header">
                <span class="batch-toggle">${isCollapsed ? '▶' : '▼'}</span>
                <span class="batch-icon">⧉</span>
                <span class="batch-label">Batch</span>
                <span class="batch-count">${batchRequests.length}</span>
                ${hasAnyErrors ? '<span class="error-indicator" title="Contains errors">⚠</span>' : ''}
              </div>
              <div class="batch-time">${firstReq.timestamp}</div>
              <span class="request-status ${firstReq.status >= 200 && firstReq.status < 300 ? 'success' : 'error'}">${firstReq.status}</span>
            </div>
            <div class="batch-children ${isCollapsed ? 'hidden' : ''}">
              ${batchRequests.map((bReq, bIdx) => `
                <div class="request-item batch-child ${bReq.id === this.selectedRequestId ? 'active' : ''} ${bIdx === batchRequests.length - 1 ? 'last-child' : ''}" data-id="${bReq.id}">
                  <div class="tree-line"></div>
                  <div class="request-row">
                    <span class="request-type ${bReq.operationType}">${bReq.operationType.slice(0, 1).toUpperCase()}</span>
                    <span class="request-name" title="${this.escapeHtml(bReq.operationName || 'Anonymous')}">${this.escapeHtml(bReq.operationName || 'Anonymous')}</span>
                    ${bReq.hasErrors ? '<span class="error-indicator" title="Has errors">⚠</span>' : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      } else {
        // Single request
        html += `
          <div class="request-item ${req.id === this.selectedRequestId ? 'active' : ''}" data-id="${req.id}">
            <div class="request-row">
              <span class="request-type ${req.operationType}">${req.operationType.slice(0, 1).toUpperCase()}</span>
              <span class="request-name" title="${this.escapeHtml(req.operationName || 'Anonymous')}">${this.escapeHtml(req.operationName || 'Anonymous')}</span>
              ${req.hasErrors ? '<span class="error-indicator" title="Has errors">⚠</span>' : ''}
              <span class="request-status ${req.status >= 200 && req.status < 300 ? 'success' : 'error'}">${req.status}</span>
            </div>
            <div class="request-time">${req.timestamp}</div>
          </div>
        `;
      }
    });

    itemsContainer.innerHTML = html;

    // Event listeners for single requests
    itemsContainer.querySelectorAll('.request-item:not(.batch-child)').forEach(item => {
      item.addEventListener('click', () => {
        this.selectRequest(parseFloat(item.dataset.id));
      });
    });

    // Event listeners for batch children
    itemsContainer.querySelectorAll('.request-item.batch-child').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectRequest(parseFloat(item.dataset.id));
      });
    });

    // Event listeners for batch headers
    itemsContainer.querySelectorAll('.batch-header-container').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.classList.contains('batch-toggle')) {
          this.toggleBatch(header.dataset.batchId);
        } else {
          let element = e.target;
          let isToggle = false;
          while (element && element !== header) {
            if (element.classList.contains('batch-toggle')) {
              isToggle = true;
              break;
            }
            element = element.parentElement;
          }
          
          if (isToggle) {
            this.toggleBatch(header.dataset.batchId);
          } else {
            this.selectRequest(parseFloat(header.dataset.firstId));
          }
        }
      });
    });

    if (!this.selectedRequestId && filteredRequests.length > 0) {
      this.selectRequest(filteredRequests[0].id);
    }
  }

  toggleBatch(batchId) {
    if (this.collapsedBatches.has(batchId)) {
      this.collapsedBatches.delete(batchId);
    } else {
      this.collapsedBatches.add(batchId);
    }
    this.renderRequestList();
  }

  selectRequest(requestId) {
    this.selectedRequestId = requestId;
    this.renderRequestList();
    this.renderDetailPanel();
  }

  renderDetailPanel() {
    const request = this.requests.find(r => r.id === this.selectedRequestId);
    const detailContent = document.getElementById('detailContent');
    
    if (!request) {
      detailContent.innerHTML = '<div class="detail-empty">Select a request to view details</div>';
      return;
    }

    const hasVariables = request.variables && Object.keys(request.variables).length > 0;
    const responseSize = this.getDataSize(request.response);
    const hasErrors = request.hasErrors;

    detailContent.innerHTML = `
      <div class="tabs">
        <button class="tab ${this.activeTab === 'query' ? 'active' : ''}" data-tab="query">Query</button>
        <button class="tab ${this.activeTab === 'response' ? 'active' : ''}" data-tab="response">
          Response <span class="tab-size">${responseSize}</span>
          ${hasErrors ? '<span class="tab-error-badge">!</span>' : ''}
        </button>
        <button class="tab ${this.activeTab === 'headers' ? 'active' : ''}" data-tab="headers">Headers</button>
      </div>
      <div class="tab-content">
        <div class="tab-panel ${this.activeTab === 'query' ? 'active' : ''}" data-panel="query">
          <div class="section">
            <div class="section-header">
              <span class="section-title">Query</span>
              <button class="copy-btn" data-copy="query">Copy</button>
            </div>
            <pre class="query-display" id="query-content">${this.formatQuery(request.query)}</pre>
          </div>
          ${hasVariables ? `
          <div class="section">
            <div class="section-header">
              <span class="section-title">Variables</span>
              <button class="copy-btn" data-copy="variables">Copy</button>
            </div>
            <pre class="variables-display" id="variables-content"></pre>
          </div>
          ` : ''}
        </div>
        <div class="tab-panel ${this.activeTab === 'response' ? 'active' : ''}" data-panel="response">
          ${hasErrors ? `
          <div class="section error-section">
            <div class="section-header error-header">
              <span class="section-title">⚠ Errors (${request.errors.length})</span>
            </div>
            <div class="error-list">
              ${request.errors.map((err, idx) => `
                <div class="error-item">
                  <div class="error-message">${this.escapeHtml(err.message || 'Unknown error')}</div>
                  ${err.path ? `<div class="error-path">Path: ${err.path.map(p => this.escapeHtml(String(p))).join(' → ')}</div>` : ''}
                  ${err.extensions ? `<div class="error-extensions">${this.escapeHtml(JSON.stringify(err.extensions))}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}
          <div class="section">
            <div class="section-header">
              <span class="section-title">Response</span>
              <button class="copy-btn" data-copy="response">Copy</button>
            </div>
            <div class="json-display" id="response-content"></div>
          </div>
        </div>
        <div class="tab-panel ${this.activeTab === 'headers' ? 'active' : ''}" data-panel="headers">
          <div class="section">
            <div class="section-header">
              <span class="section-title">Request Information</span>
            </div>
            <div class="request-info">
              <div class="info-row">
                <span class="info-label">Request URL</span>
                <span class="info-value" title="${this.escapeHtml(request.url)}">${this.escapeHtml(request.url)}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Request Method</span>
                <span class="info-value">${request.method}</span>
              </div>
              <div class="info-row">
                <span class="info-label">HTTP Status</span>
                <span class="info-value status-value ${this.getStatusColor(request.status)}">
                  ${request.status} ${this.getStatusText(request.status)}
                  <span class="status-icon">${request.status >= 200 && request.status < 300 ? '✓' : '✗'}</span>
                </span>
              </div>
            </div>
          </div>
          <div class="section">
            <div class="section-header">
              <span class="section-title">Request Headers</span>
              <button class="copy-btn" data-copy="request-headers">Copy</button>
            </div>
            <pre class="headers-display" id="request-headers-content"></pre>
          </div>
          <div class="section">
            <div class="section-header">
              <span class="section-title">Response Headers</span>
              <button class="copy-btn" data-copy="response-headers">Copy</button>
            </div>
            <pre class="headers-display" id="response-headers-content"></pre>
          </div>
        </div>
      </div>
    `;

    // Store raw data for copy
    this.currentRequest = request;

    // Initialize tabs
    detailContent.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        this.renderDetailPanel();
      });
    });

    // Initialize copy buttons
    detailContent.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleCopy(btn.dataset.copy, btn));
    });

    // Render variables with line numbers
    if (hasVariables && this.activeTab === 'query') {
      const varsContainer = document.getElementById('variables-content');
      varsContainer.innerHTML = this.formatVariables(request.variables);
    }

    // Render headers
    if (this.activeTab === 'headers') {
      const reqHeadersContainer = document.getElementById('request-headers-content');
      const respHeadersContainer = document.getElementById('response-headers-content');
      reqHeadersContainer.innerHTML = this.formatHeaders(request.requestHeaders);
      respHeadersContainer.innerHTML = this.formatHeaders(request.responseHeaders);
    }

    if (this.activeTab === 'response') {
      const respContainer = document.getElementById('response-content');
      const respFormatter = new JSONFormatter(request.response, 3, {
        // hoverPreviewEnabled: true,
        theme: 'dark'
      });
      respContainer.appendChild(respFormatter.render());
    }
  }

  getStatusText(status) {
    const statusMap = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      301: 'Moved Permanently',
      302: 'Found',
      304: 'Not Modified',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      408: 'Request Timeout',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      501: 'Not Implemented',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout'
    };
    return statusMap[status] || 'Unknown';
  }

  getStatusColor(status) {
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'info';
    if (status >= 400 && status < 500) return 'warning';
    return 'error';
  }

  getDataSize(data) {
    const str = JSON.stringify(data);
    const bytes = new Blob([str]).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatQuery(query) {
    if (!query) return '';
    const formatted = this.prettifyQuery(query);
    const highlighted = this.highlightQuery(formatted);
    return this.addLineNumbers(highlighted);
  }

  addLineNumbers(code) {
    const lines = code.split('\n');
    const lineNumWidth = String(lines.length).length;
    return lines.map((line, i) => {
      const num = String(i + 1).padStart(lineNumWidth, ' ');
      return `<span class="line-num">${num}</span>${line}`;
    }).join('\n');
  }

  formatVariables(variables) {
    if (!variables || Object.keys(variables).length === 0) return '';
    const json = JSON.stringify(variables, null, 2);
    const highlighted = this.highlightJSON(json);
    return this.addLineNumbers(highlighted);
  }

  formatHeaders(headers) {
    if (!headers || Object.keys(headers).length === 0) return 'No headers';
    const entries = Array.isArray(headers) ? headers : Object.entries(headers).map(([key, value]) => ({ name: key, value }));
    let formatted = entries.map(entry => {
      const key = typeof entry === 'object' ? entry.name : Object.keys(entry)[0];
      const value = typeof entry === 'object' ? entry.value : entry[key];
      return `${key}: ${value}`;
    }).join('\n');
    
    const highlighted = formatted
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^([^:]+):/gm, '<span class="header-key">$1</span>:');
    
    return this.addLineNumbers(highlighted);
  }

  highlightJSON(json) {
    return json
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
      .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
      .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
      .replace(/: (null)/g, ': <span class="json-null">$1</span>');
  }

  prettifyQuery(query) {
    let q = query.replace(/\s+/g, ' ').trim();
    let result = '';
    let indent = 0;
    let inString = false;
    let parenDepth = 0;
    
    for (let i = 0; i < q.length; i++) {
      const char = q[i];
      const prev = q[i - 1];
      const next = q[i + 1];
      
      // Handle strings
      if (char === '"' && prev !== '\\') {
        inString = !inString;
        result += char;
        continue;
      }
      if (inString) {
        result += char;
        continue;
      }
      
      // Add blank line before fragment/query/mutation/subscription at root level
      if (indent === 0 && parenDepth === 0) {
        const remaining = q.slice(i);
        if (/^(fragment|query|mutation|subscription)\s/.test(remaining)) {
          if (result.trim()) {
            result += '\n';
          }
        }
      }
      
      if (char === '{') {
        result = result.trimEnd();
        result += ' {\n' + '  '.repeat(indent + 1);
        indent++;
        continue;
      }
      
      if (char === '}') {
        indent--;
        result = result.trimEnd();
        result += '\n' + '  '.repeat(indent) + '}';
        continue;
      }
      
      if (char === '(') {
        parenDepth++;
        result += '(\n' + '  '.repeat(indent + 1);
        indent++;
        continue;
      }
      
      if (char === ')') {
        parenDepth--;
        indent--;
        result = result.trimEnd();
        result += '\n' + '  '.repeat(indent) + ')';
        continue;
      }
      
      // Newline after comma inside parens (arguments)
      if (char === ',' && parenDepth > 0) {
        result = result.trimEnd();
        result += '\n' + '  '.repeat(indent);
        continue;
      }
      
      // Handle spaces - newline for fields inside braces (not in parens)
      if (char === ' ' && parenDepth === 0 && indent > 0) {
        // Check if this is between two field names/tokens
        if (/[a-zA-Z_\d\}\)]/.test(prev) && /[a-zA-Z_@\.\{]/.test(next)) {
          result += '\n' + '  '.repeat(indent);
          continue;
        }
      }
      
      // Skip leading spaces
      if (char === ' ' && (result === '' || result.endsWith('\n') || result.endsWith('  '))) {
        continue;
      }
      
      result += char;
    }
    
    return result.trim();
  }

  highlightQuery(code) {
    // Escape HTML entities first
    let escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Use unique markers that won't appear in GraphQL
    const markers = {
      kwOpen: '\u0001KW\u0002',
      kwClose: '\u0001/KW\u0002',
      varOpen: '\u0001VAR\u0002',
      varClose: '\u0001/VAR\u0002',
      typeOpen: '\u0001TYPE\u0002',
      typeClose: '\u0001/TYPE\u0002',
      strOpen: '\u0001STR\u0002',
      strClose: '\u0001/STR\u0002'
    };
    
    // Apply syntax highlighting with markers
    let result = escaped;
    
    // Strings
    result = result.replace(/"([^"]*)"/g, `${markers.strOpen}"$1"${markers.strClose}`);
    
    // Keywords
    result = result.replace(/(^|\s)(query|mutation|subscription|fragment)(?=\s|$|\()/gm, `$1${markers.kwOpen}$2${markers.kwClose}`);
    result = result.replace(/(\s)(on)(\s+)([A-Z])/g, `$1${markers.kwOpen}$2${markers.kwClose}$3$4`);
    result = result.replace(/(^|[\s\(:])(\btrue\b|\bfalse\b|\bnull\b)(?=[\s,\)\}]|$)/gm, `$1${markers.kwOpen}$2${markers.kwClose}`);
    
    // Variables
    result = result.replace(/(\$\w+)/g, `${markers.varOpen}$1${markers.varClose}`);
    
    // Types after colon
    result = result.replace(/(:\s*)(\[?)([A-Z]\w*)([!\]]*)/g, `$1$2${markers.typeOpen}$3${markers.typeClose}$4`);
    
    // Convert markers to HTML spans
    return result
      .replace(/\u0001KW\u0002/g, '<span class="kw">')
      .replace(/\u0001\/KW\u0002/g, '</span>')
      .replace(/\u0001VAR\u0002/g, '<span class="var">')
      .replace(/\u0001\/VAR\u0002/g, '</span>')
      .replace(/\u0001TYPE\u0002/g, '<span class="type">')
      .replace(/\u0001\/TYPE\u0002/g, '</span>')
      .replace(/\u0001STR\u0002/g, '<span class="str">')
      .replace(/\u0001\/STR\u0002/g, '</span>');
  }

  handleCopy(type, btn) {
    let text = '';
    if (type === 'query') {
      text = this.prettifyQuery(this.currentRequest.query);
    } else if (type === 'variables') {
      text = JSON.stringify(this.currentRequest.variables, null, 2);
    } else if (type === 'request-headers') {
      text = this.headersToString(this.currentRequest.requestHeaders);
    } else if (type === 'response-headers') {
      text = this.headersToString(this.currentRequest.responseHeaders);
    } else if (type === 'response') {
      text = JSON.stringify(this.currentRequest.response, null, 2);
    }

    const showSuccess = () => {
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1500);
    };

    // Try DevTools inspectedWindow.eval with copy() - works in DevTools context
    if (chrome.devtools?.inspectedWindow) {
      const escaped = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
      chrome.devtools.inspectedWindow.eval(`copy(\`${escaped}\`)`, (result, error) => {
        if (!error) {
          showSuccess();
        } else {
          this.fallbackCopy(text, showSuccess);
        }
      });
    } else {
      this.fallbackCopy(text, showSuccess);
    }
  }

  headersToString(headers) {
    if (!headers || Object.keys(headers).length === 0) return 'No headers';
    const entries = Array.isArray(headers) ? headers : Object.entries(headers).map(([key, value]) => ({ name: key, value }));
    return entries.map(entry => {
      const key = typeof entry === 'object' ? entry.name : Object.keys(entry)[0];
      const value = typeof entry === 'object' ? entry.value : entry[key];
      return `${key}: ${value}`;
    }).join('\n');
  }

  fallbackCopy(text, onSuccess) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    
    try {
      document.execCommand('copy');
      onSuccess();
    } catch (e) {}
    document.body.removeChild(textarea);
  }

  clearRequests() {
    this.requests = [];
    this.selectedRequestId = null;
    this.updateRequestCount();
    this.renderRequestList();
    document.getElementById('detailContent').innerHTML = '<div class="detail-empty">Select a request</div>';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new GraphQLTracker());
} else {
  new GraphQLTracker();
}
