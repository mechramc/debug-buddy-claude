# Debug Buddy - AI-Powered Browser Debugging Assistant Using Claude Code

⚠️ Debug Buddy requires your own Anthropic (Claude) API key to generate fixes.

<p align="center">
  <img src="icons/icon128.png" alt="Debug Buddy Logo" width="128">
</p>

**Debug Buddy** is a Chrome extension that monitors browser console errors in real-time and uses Claude AI to provide instant explanations and code fixes. It displays in a convenient side panel, so it doesn't block your work.

## Features

- 🔍 **Real-time Error Detection** - Automatically captures console.error, console.warn, uncaught exceptions, and network failures
- 🤖 **AI-Powered Analysis** - Uses Claude Sonnet 4 to analyze errors and provide actionable fixes
- 📋 **Copy-to-Clipboard** - One-click copy for suggested code fixes
- 🎯 **Domain Whitelist** - Only monitors specific domains (localhost, staging sites, etc.)
- 🎨 **Clean Side Panel UI** - Non-intrusive interface that doesn't block your work
- ⚡ **Rate Limited** - Smart rate limiting to avoid API spam (1 request/second)

## Installation
> Requires a recent version of Chrome with Side Panel support (Chrome 114+).

### Step 1: Download the Extension

Clone or download this repository to your local machine:

```bash
git clone https://github.com/mechramc/debug-buddy-claude.git
# or download and extract the ZIP file
```

### Step 2: Load in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `debug-buddy-claude` folder containing `manifest.json`

### Step 3: Configure Your API Key

1. Click the Debug Buddy icon in your Chrome toolbar
2. Click the **Settings** (gear) icon in the side panel
3. Enter your Anthropic API key
4. Click **Save Settings**

> 💡 **Get your API key:** Visit [console.anthropic.com](https://console.anthropic.com) to create an account and generate an API key.

## Configuration

### API Key

Your Anthropic API key is stored securely in Chrome's sync storage. To update it:

1. Open the Debug Buddy side panel
2. Click the Settings icon (⚙️)
3. Enter your new API key
4. Click Save Settings

### Domain Whitelist

By default, Debug Buddy only monitors errors on these domains:

- `localhost`
- `127.0.0.1`
- `*.local`
- `staging.*`
- `*.staging.*`

To customize the whitelist:

1. Open Settings
2. Edit the domain list (one domain per line)
3. Use `*` as a wildcard (e.g., `*.example.com`)
4. Click Save Settings

### Enable/Disable Monitoring

You can temporarily disable error monitoring without uninstalling the extension:

1. Open Settings
2. Toggle "Enable error monitoring"
3. Click Save Settings

## Usage

### Viewing Errors

1. Open any website in your whitelist
2. Click the Debug Buddy icon to open the side panel
3. Errors will appear automatically as they occur
4. Click any error to see detailed analysis

### Understanding the Analysis

Each error analysis includes:

| Field | Description |
|-------|-------------|
| **Severity** | Low, Medium, High, or Critical |
| **Explanation** | Clear description of what happened |
| **Root Cause** | Why the error occurred |
| **Suggested Fix** | Copy-paste ready code solution |
| **Prevention** | How to avoid this error in the future |

### Copying Fixes

1. Click an error to open the detail view
2. Scroll to the "Suggested Fix" section
3. Click the **Copy Fix** button
4. Paste the fix into your code

## File Structure

```
debug-buddy/
├── manifest.json       # Extension configuration (Manifest V3)
├── background.js       # Service worker (API calls, error handling)
├── content.js          # Content script (captures errors from pages)
├── sidepanel.html      # Side panel UI structure
├── sidepanel.js        # Side panel logic and rendering
├── styles.css          # UI styling
├── options.html        # Settings page
├── icons/
│   ├── icon16.png      # Toolbar icon (16x16)
│   ├── icon48.png      # Extension page icon (48x48)
│   └── icon128.png     # Chrome Web Store icon (128x128)
└── README.md           # This file
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│                 │     │                  │     │                 │
│   Web Page      │────▶│   content.js     │────▶│  background.js  │
│                 │     │  (Captures       │     │  (Rate limits,  │
│  console.error  │     │   errors)        │     │   API calls)    │
│  window.onerror │     │                  │     │                 │
│                 │     └──────────────────┘     └────────┬────────┘
└─────────────────┘                                       │
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│                 │     │                  │     │                 │
│  Claude API     │◀────│   API Request    │◀────│  sidepanel.js   │
│                 │     │                  │     │  (Displays      │
│  Analysis &     │────▶│   API Response   │────▶│   results)      │
│  Fix Generation │     │                  │     │                 │
│                 │     └──────────────────┘     └─────────────────┘
└─────────────────┘
```

## Error Types Captured

| Type | Description |
|------|-------------|
| `error` | console.error() calls |
| `warning` | console.warn() calls |
| `exception` | Uncaught JavaScript exceptions |
| `promise_rejection` | Unhandled Promise rejections |
| `network_error` | Failed fetch/XHR requests (4xx, 5xx) |

## API Usage

Debug Buddy uses the Anthropic Messages API:

- **Endpoint:** `https://api.anthropic.com/v1/messages`
- **Model:** `claude-sonnet-4-20250514`
- **Rate Limit:** 1 request per second (enforced by extension)
- **Max Tokens:** 1024 per response

### Estimated Costs

Approximate costs based on typical usage:

| Errors/Day | Est. Monthly Cost |
|------------|-------------------|
| 10 | ~$0.30 |
| 50 | ~$1.50 |
| 100 | ~$3.00 |

*Costs vary based on error complexity and stack trace length.*

## Troubleshooting

### "API key not configured" Warning

1. Open the Settings panel
2. Enter a valid Anthropic API key
3. Make sure it starts with `sk-ant-`

### Errors Not Being Captured

1. Check if the domain is in your whitelist
2. Verify the extension is enabled
3. Refresh the page after making changes
4. Check the browser console for extension errors

### Analysis Failing

1. Verify your API key is valid
2. Check your Anthropic account has available credits
3. Check your network connection
4. Look for rate limit messages in the console

### Side Panel Not Opening

1. Click the Debug Buddy icon in the toolbar
2. If the icon isn't visible, click the puzzle piece (🧩) and pin Debug Buddy
3. Try refreshing the page

## Development

### Building from Source

No build step required! The extension uses vanilla JavaScript and can be loaded directly.

### Making Changes

1. Edit the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon (🔄) on the Debug Buddy card
4. Reload the page you're testing

### Adding New Error Types

Edit `content.js` to capture additional error types. The `sendErrorToBackground()` function accepts any error object with these fields:

```javascript
{
  type: 'custom_error',
  message: 'Error message',
  filename: 'source.js',
  lineno: 42,
  colno: 10,
  stack: 'Error stack trace...'
}
```

## Privacy & Security

- **API Key Storage:** Your API key is stored in Chrome's sync storage and never sent anywhere except Anthropic's API
- **Error Data:** Error messages and stack traces are sent to Claude API for analysis
- **No Tracking:** Debug Buddy does not collect analytics or track usage
- **Local Only:** All error data is stored locally in your browser

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Roadmap

### v2.0 (Planned)
- [ ] Visual/CSS screenshot analysis
- [ ] Team dashboard
- [ ] Error sharing/export

### v2.1 (Planned)
- [ ] Payment integration (Pro tier)
- [ ] Usage analytics
- [ ] Custom AI prompts

---

**Made with ❤️ for developers who hate cryptic error messages**
