# GraphQL Tracker

A Chrome/Edge DevTools extension that intercepts and inspects GraphQL network requests in real-time — helping you debug APIs, inspect queries, and understand client–server interactions.

---

## Features

- **Live GraphQL Detection** — Automatically captures GraphQL POST requests as they happen, filtering out REST and analytics noise with strict query-body validation
- **Batch Request Support** — Groups batched GraphQL operations together with collapsible tree view
- **Query & Variables View** — View the full GraphQL query with syntax highlighting and any variables passed with the operation
- **Response Viewer** — Collapsible JSON tree with inline error highlighting and error path display
- **Headers Inspector** — View full request and response headers per operation
- **HTTP Status Indicators** — Color-coded success/error badges on every request
- **Search & Filter** — Filter requests by operation name or URL in real-time
- **Preserve Log** — Keep requests across page navigations (persisted via `localStorage`)
- **Copy to Clipboard** — One-click copy for query, variables, response, request headers, and response headers
- **Request Count Badge** — Live count of captured GraphQL requests

---

## Installation

### From Source (Developer Mode)

1. Clone the repository:
   ```bash
   git clone https://github.com/lpuli19/graphql-tracker-chrome-extension.git
   ```
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select the repository folder
5. Open DevTools (`F12` or `Cmd+Option+I`) → select the **GraphQL Tracker** panel

### Microsoft Edge

Same steps as Chrome — navigate to `edge://extensions` and enable Developer mode.

---

## Usage

1. Open Chrome DevTools on any page (`F12`)
2. Click the **GraphQL Tracker** tab in the DevTools panel
3. Perform actions on the page that trigger GraphQL requests
4. Click any request in the left panel to inspect it

### Panel Overview

| Area | Description |
|------|-------------|
| Left panel | List of captured GraphQL operations with type badge (Q/M/S), name, status code, and timestamp |
| **Query tab** | Full GraphQL query document + variables (if present) |
| **Response tab** | Collapsible JSON response tree; errors shown in a highlighted section above |
| **Headers tab** | Request URL, method, HTTP status, and full request/response headers |

### Toolbar Controls

| Control | Description |
|---------|-------------|
| 🗑 **Clear** | Remove all captured requests |
| **Preserve Log** | When checked, requests are not cleared on page navigation |
| **Search** | Filter by operation name or URL |

---

## How GraphQL Detection Works

The extension only captures requests that are genuine GraphQL operations. A POST request is treated as GraphQL if its JSON body contains a `query` field whose value starts with one of:

- `query { ... }` or `query OperationName { ... }`
- `mutation { ... }`
- `subscription { ... }`
- `fragment ...`
- `{ ... }` (shorthand query)

This strict validation prevents REST APIs, analytics endpoints, and search APIs that happen to use a `"query"` JSON key from appearing in the panel.

---

## Project Structure

```
graphql-tracker-chrome-extension/
├── manifest.json          # Chrome Extension Manifest v3
├── panel.html             # DevTools panel UI
├── scripts/
│   ├── devtools.js        # Registers the DevTools panel
│   └── panel.js           # Core extension logic (GraphQLTracker class)
├── styles/
│   ├── panel.css          # Panel styles
│   └── fonts.css          # Local @font-face declarations
├── fonts/                 # Bundled Inter + Source Code Pro font files
├── lib/
│   ├── json-formatter.min.js  # JSON tree renderer
│   └── json-formatter.css
└── images/
    └── icon-graphql.png   # Extension icon
```

---

## Permissions

| Permission | Reason |
|-----------|--------|
| `devtools_page` | Required to create a DevTools panel |
| `host_permissions: <all_urls>` | Required to intercept network requests on any site via the DevTools Network API |

No user data is collected, stored remotely, or transmitted anywhere. All data remains in-memory within the DevTools panel for the current session.

---

## Development

No build step required. The extension runs directly from source files.

To make changes:
1. Edit files in `scripts/`, `styles/`, or `panel.html`
2. Go to `chrome://extensions` and click the **↺ reload** button on the extension card
3. Close and reopen DevTools

---

## Browser Compatibility

| Browser | Supported |
|---------|-----------|
| Chrome 88+ | ✅ |
| Microsoft Edge 88+ | ✅ |
| Firefox | ❌ (uses different DevTools API) |
| Safari | ❌ |

---

## License

[MIT](LICENSE)

