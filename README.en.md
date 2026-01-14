[English](README.en.md)｜[中文](README.md)

# Cloze Reading Extension

Turn any article into a **cloze test** powered by LLMs, so you read more actively and remember better.

## Features

### Core
- **Smart article extraction**: based on Mozilla Readability, only operates on the main content area and skips navigation bars, sidebars, footers and other noise.
- **AI‑generated cloze questions**: supports multiple LLM providers (Ollama / local, Google AI Studio, Alibaba DashScope).
- **In‑page interactive quiz**: questions are rendered directly in the original article, with dropdowns for answers and instant feedback with explanations.


## Installation

### Install
1. Open the browser extension page  
   Chrome: `chrome://extensions/`, Edge: `edge://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this `cloze-reading` directory
4. Open any article and click the extension icon

### How to use
1. On an article page, click the extension icon to open the floating panel in the top‑right corner
2. Choose an **API Provider** and fill in the corresponding API key / model name
3. Use the **UI Language** switch (中文 / EN) in the top‑right to toggle the interface language
4. Click **Start** and wait for the progress bar to complete
5. Answer questions inline in the article and click **Submit** to see the result and explanations
6. Click **Restore** to fully restore the original article

## Configuration

### Open settings
Click the gear icon (⚙️) in the top‑right of the floating panel.

### UI Language
- Supports **Simplified Chinese** and **English**.
- The choice is persisted in browser storage and applied automatically next time.

### Supported providers

#### 1. Ollama (local)
- **When to use**: local deployment, data stays on your machine, works offline or at very low cost.
- **Config**:
  - **Ollama Base URL**: default `http://localhost:11434`
  - **Model**: `name:tag`, e.g. `qwen2.5:7b`, `llama3:8b`
- **Before you start**:
  - Install and start Ollama
  - To allow CORS from the extension:  
    macOS/Linux: `export OLLAMA_ORIGINS="*"`  
    Windows: `$env:OLLAMA_ORIGINS="*"`

#### 2. Google AI Studio
- **When to use**: stable access to Google services and strong English LLMs.
- **Config**:
  - **API Key**: from [Google AI Studio](https://aistudio.google.com/apikey)
  - **Model**: `gemini-version-type`, e.g. `gemini-2.5-flash`, `gemini-1.5-pro`
- **Recommended**:
  - `gemini-2.5-flash`: fast, great for interactive usage
  - `gemini-1.5-pro`: stronger reasoning, good for complex texts

#### 3. Alibaba DashScope
- **When to use**: mainland China network, need stable access.
- **Config**:
  - **API Key**: from [DashScope console](https://dashscope.console.aliyun.com/)
  - **Model**: `qwen-*`, e.g. `qwen-turbo`, `qwen-plus`, `qwen-max`, `qwen-long`
- **Recommended**:
  - `qwen-turbo`: best price/performance for everyday use
  - `qwen-plus`: stronger, recommended default
  - `qwen-max`: strongest model
  - `qwen-long`: extra‑long context



## FAQ

### Ollama 403 / CORS issues
This is usually caused by CORS restrictions:
- macOS/Linux: run `export OLLAMA_ORIGINS="*"` and restart Ollama
- Windows: run `$env:OLLAMA_ORIGINS="*"` in PowerShell and restart Ollama
- Or create `~/.ollama/ollama.env` with `OLLAMA_ORIGINS=*`

### No questions generated
- Verify your API key
- Check the network connection
- Make sure the paragraph is long enough (roughly ≥ 15 tokens)
- Some pages may have unusual HTML structure that can’t be parsed reliably



## Third‑party code

- **Mozilla Readability**: `src/vendor/readability/Readability.js`  
  License: Apache‑2.0  
  Location: `src/vendor/readability/LICENSE.md`



## Development

### Project structure
```text
cloze-reading/
├── manifest.json          # Chrome/Edge extension manifest
├── src/
│   ├── background.js      # Background service worker – handles API calls
│   ├── content.js         # Content script – UI, DOM injection, cloze rendering
│   ├── ui.css             # Styles for floating panel & in‑page UI
│   └── vendor/            # Vendored third‑party libs (Readability, etc.)
└── README.md
```

### Permissions
- `activeTab`: access the active tab
- `scripting`: inject content scripts
- `storage`: persist user settings
- `host_permissions`: call external APIs

