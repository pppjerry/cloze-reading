// src/content.js
// Cloze-Reading v2.0 Content Script

// 日志工具：检查是否是开发版本
// 如果扩展名称（name）包含 -debug, -dev, -test, -beta 等后缀，则认为是开发版本，会打印日志
// 正式版本（name 为 "cloze-reading"）不会打印日志
function isDevVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    const name = manifest.name || '';
    // 检查扩展名称是否包含开发标识
    return /-(dev|test|beta|alpha|debug)/i.test(name);
  } catch (e) {
    // 如果无法获取 manifest，默认认为是开发版本（安全起见）
    return true;
  }
}

// 避免重复声明 DEBUG（当脚本被多次注入时）
if (typeof window.__CLOZE_READING_DEBUG__ === 'undefined') {
  window.__CLOZE_READING_DEBUG__ = isDevVersion();
}

// 日志函数：只在开发版本中打印
function debugLog(...args) {
  if (window.__CLOZE_READING_DEBUG__) {
    console.log(...args);
  }
}

function debugWarn(...args) {
  if (window.__CLOZE_READING_DEBUG__) {
    console.warn(...args);
  }
}

function debugError(...args) {
  // 错误日志始终打印，即使在生产版本
  console.error(...args);
}

// 检查扩展上下文是否有效
function isExtensionContextValid() {
  try {
    return chrome.runtime && chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// 安全地调用 chrome.storage
async function safeStorageGet(keys) {
  if (!isExtensionContextValid()) {
    throw new Error('扩展上下文已失效，请刷新页面后重试');
  }
  try {
    return await chrome.storage.sync.get(keys);
  } catch (e) {
    if (e.message && e.message.includes('Extension context invalidated')) {
      throw new Error('扩展已更新，请刷新页面后重试');
    }
    throw e;
  }
}

// 安全地调用 chrome.storage.set
async function safeStorageSet(items) {
  if (!isExtensionContextValid()) {
    throw new Error('扩展上下文已失效，请刷新页面后重试');
  }
  try {
    return await chrome.storage.sync.set(items);
  } catch (e) {
    if (e.message && e.message.includes('Extension context invalidated')) {
      throw new Error('扩展已更新，请刷新页面后重试');
    }
    throw e;
  }
}

// 安全地调用 chrome.runtime.sendMessage
async function safeSendMessage(message) {
  if (!isExtensionContextValid()) {
    throw new Error('扩展上下文已失效，请刷新页面后重试');
  }
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (e) {
    if (e.message && e.message.includes('Extension context invalidated')) {
      throw new Error('扩展已更新，请刷新页面后重试');
    }
    throw e;
  }
}

// 辅助函数：获取 provider 名称
function getProviderName(apiProvider) {
  const names = { ollama: 'Ollama', google: 'Google AI', dashscope: 'DashScope' };
  return names[apiProvider] || 'Ollama';
}

// 辅助函数：根据 provider 获取模型名
function getModelFromConfig(config, apiProvider) {
  if (apiProvider === 'google') return config.googleModel || 'gemini-2.5-flash';
  if (apiProvider === 'dashscope') return config.dashscopeModel || 'qwen-plus';
  return config.ollamaModel || 'qwen2.5:7b';
}

// 检查是否已经初始化过
if (!window.ClozeReadingApp) {
  // 定义核心应用对象
  window.ClozeReadingApp = {
    state: {
      isProcessing: false,
      paragraphs: [],
      model: 'qwen2.5:7b',
      stats: { total: 0, done: 0, success: 0 },
      language: 'zh', // 'zh' | 'en'，界面语言
      statusKey: null,
      statusParams: null,
      statusText: '',
      generationStartTime: null,
    },

    // 简单的中英文文案
    i18n: {
      zh: {
        title: '📝 Cloze Reading',
        btnGenerate: '开始生成',
        btnSubmit: '提交答案',
        btnReset: '恢复原文',
        settingsSave: '保存设置',
        labelApiProvider: 'API 提供者',
        labelLanguage: '界面语言 / UI Language',
        providerOllama: 'Ollama (本地)',
        providerGoogle: 'Google AI Studio',
        providerDashscope: '阿里云通义千问',
        status: {
          statusReady: '准备就绪',
          score: '得分: {correct} / {total}',
          restored: '已恢复原文 (当前: {provider})',
          checkingConnection: '检查连接: {provider}...',
          connectFailedUnknown: '连接失败: 无法获取服务状态，请检查扩展是否正常运行',
          connectFailedWithError: '连接失败: {error}',
          modelNotReady: '模型 {model} 未下载或不可用。请点击设置图标检查配置。',
          parsing: '正在解析网页...',
          parseFailed: '正文识别失败: {error}',
          noParagraphs: '未找到适合生成的正文段落',
          generating: '生成中 ({provider}) {current}/{total}...',
          generatedSummary: '生成完成! 成功 {success}/{total}（耗时 {seconds} 秒）',
          canContinue: '可以继续做题或提交答案',
          contextInvalid: '扩展上下文失效，请刷新页面',
          contextInvalidWithRetry: '错误：浮动面板未初始化，请刷新页面后重试',
          unknownProvider: '未知的 API 提供者',
          settingsSaved: '设置已保存！',
        },
      },
      en: {
        title: '📝 Cloze Reading',
        btnGenerate: 'Start',
        btnSubmit: 'Submit',
        btnReset: 'Restore',
        settingsSave: 'Save Settings',
        labelApiProvider: 'API Provider',
        labelLanguage: 'UI Language',
        providerOllama: 'Ollama (local)',
        providerGoogle: 'Google AI Studio',
        providerDashscope: 'Alibaba DashScope',
        status: {
          statusReady: 'Ready',
          score: 'Score: {correct} / {total}',
          restored: 'Original restored (current: {provider})',
          checkingConnection: 'Checking: {provider}...',
          connectFailedUnknown: 'Connection failed: cannot reach service, please check whether the extension is running.',
          connectFailedWithError: 'Connection failed: {error}',
          modelNotReady: 'Model {model} is not downloaded or unavailable. Click the settings icon to check configuration.',
          parsing: 'Parsing page...',
          parseFailed: 'Content extraction failed: {error}',
          noParagraphs: 'No suitable paragraphs found for question generation.',
          generating: 'Generating ({provider}) {current}/{total}...',
          generatedSummary: 'Generation complete! Success {success}/{total} (time {seconds}s)',
          canContinue: 'You can continue practicing or submit your answers.',
          contextInvalid: 'Extension context invalid, please refresh the page.',
          contextInvalidWithRetry: 'Error: panel not initialized. Please refresh the page and try again.',
          unknownProvider: 'Unknown API provider',
          settingsSaved: 'Settings saved!',
        },
      }
    },

    // 简单的文案获取工具，支持占位符替换
    t(key, params = {}) {
      const lang = this.state.language || 'zh';
      const fallbacks = ['zh'];

      const resolve = (langKey) => {
        let value = this.i18n[langKey];
        for (const part of key.split('.')) {
          if (!value) break;
          value = value[part];
        }
        return typeof value === 'string' ? value : null;
      };

      let template = resolve(lang);
      if (!template) {
        for (const fb of fallbacks) {
          template = resolve(fb);
          if (template) break;
        }
      }
      if (!template) return '';

      return template.replace(/\{(\w+)\}/g, (_, k) =>
        Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : `{${k}}`
      );
    },

    applyLanguage(shadow) {
      const lang = this.state.language || 'zh';
      const dict = this.i18n[lang] || this.i18n.zh;

      // 更新语言选择器的值
      const langSelect = shadow.getElementById('cr-language');
      if (langSelect) {
        langSelect.value = lang;
      }

      const logo = shadow.querySelector('.cr-logo');
      if (logo) logo.textContent = dict.title;

      // 更新状态文本（如果有状态 key）
      const statusEl = shadow.querySelector('.cr-status');
      if (statusEl && this.state.statusKey) {
        statusEl.textContent = this.t(this.state.statusKey, this.state.statusParams || {});
      }

      const btnGenerate = shadow.getElementById('btn-generate');
      const btnSubmit = shadow.getElementById('btn-submit');
      const btnReset = shadow.getElementById('btn-reset');
      const btnSave = shadow.getElementById('btn-save-settings');

      if (btnGenerate) btnGenerate.textContent = dict.btnGenerate;
      if (btnSubmit) btnSubmit.textContent = dict.btnSubmit;
      if (btnReset) btnReset.textContent = dict.btnReset;
      if (btnSave) btnSave.textContent = dict.settingsSave;

      const apiLabel = shadow.querySelector('label[for="cr-api-provider-label"]');
      if (apiLabel) apiLabel.textContent = dict.labelApiProvider;

      // Provider 选项文本
      const providerSelect = shadow.getElementById('cr-api-provider');
      if (providerSelect && providerSelect.options && providerSelect.options.length >= 3) {
        const [optOllama, optGoogle, optDashscope] = providerSelect.options;
        if (optOllama) optOllama.textContent = dict.providerOllama || 'Ollama (本地)';
        if (optGoogle) optGoogle.textContent = dict.providerGoogle || 'Google AI Studio';
        if (optDashscope) optDashscope.textContent = dict.providerDashscope || '阿里云通义千问';
      }
    },
    
    async init() {
      this.injectGlobalStyles();
      this.createFloatingPanel();
      this.setupMessageListener();
      
      try {
        const config = await safeStorageGet(['apiProvider', 'ollamaModel', 'googleModel', 'dashscopeModel', 'language']);
        const apiProvider = config.apiProvider || 'ollama';
        this.state.model = getModelFromConfig(config, apiProvider);
        this.state.language = config.language || 'zh';

        const panel = document.getElementById('cr-floating-panel');
        if (panel && panel.shadowRoot) {
          this.applyLanguage(panel.shadowRoot);
        }
      } catch (e) {
        this.updateStatusKey('status.contextInvalid');
      }
    },

    setupMessageListener() {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'LOG') {
          const { level = 'log', args = [] } = request;
        if (level === 'error') {
          debugError(...args);
        } else if (level === 'warn') {
          debugWarn(...args);
        } else {
          debugLog(...args);
        }
        }
      });
    },

    injectGlobalStyles() {
      const id = 'cr-global-styles';
      if (document.getElementById(id)) return;
      
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('src/ui.css');
      document.head.appendChild(link);
    },

    async loadReadability() {
      // 如果已经加载，直接返回
      if (typeof window.Readability !== 'undefined' && typeof window.Readability === 'function') {
        debugLog('✓ Readability 已加载（通过 executeScript 注入）');
        return;
      }
      
      // 检查全局 Readability（可能通过 executeScript 注入了但还没绑定到 window）
      if (typeof Readability !== 'undefined' && typeof Readability === 'function') {
        debugLog('发现全局 Readability，绑定到 window');
        window.Readability = Readability;
        return;
      }

      // 使用 script 标签方式加载（避免 CSP 限制）
      return new Promise((resolve, reject) => {
        // 检查是否已经有脚本标签在加载
        const existingScript = document.querySelector('script[data-readability]');
        if (existingScript) {
            debugLog('Readability 脚本正在加载中，等待...');
          let attempts = 0;
          const maxAttempts = 60; // 增加到 3 秒
          const checkReadability = () => {
            attempts++;
            if (typeof window.Readability === 'function') {
                debugLog('✓ Readability 加载成功（已有脚本）');
              resolve();
            } else if (attempts >= maxAttempts) {
              reject(new Error('Readability 加载超时：window.Readability 不是函数。请刷新页面后重试。'));
            } else {
              setTimeout(checkReadability, 50);
            }
          };
          setTimeout(checkReadability, 50);
          return;
        }

        const scriptUrl = chrome.runtime.getURL('src/vendor/readability/Readability.js');
        debugLog('正在通过 script 标签加载 Readability.js:', scriptUrl);
        
        // 验证 URL 是否可访问
        fetch(scriptUrl, { method: 'HEAD' }).then(response => {
          if (!response.ok) {
            throw new Error(`Readability.js 文件不存在或无法访问: HTTP ${response.status}`);
          }
          debugLog('✓ Readability.js 文件可访问');
        }).catch(err => {
          debugWarn('无法验证 Readability.js 文件，继续尝试加载:', err);
        });

        const script = document.createElement('script');
        script.src = scriptUrl;
        script.setAttribute('data-readability', 'true');
        script.setAttribute('type', 'text/javascript');
        script.setAttribute('crossorigin', 'anonymous');
        
        // 监听脚本执行错误（通过全局错误处理）
        const originalOnerror = window.onerror;
        let scriptError = null;
        window.onerror = (message, source, lineno, colno, error) => {
          if (source && source.includes('Readability.js')) {
            scriptError = { message, source, lineno, colno, error };
            console.error('Readability.js 执行错误:', scriptError);
            return true; // 阻止默认错误处理
          }
          if (originalOnerror) {
            return originalOnerror(message, source, lineno, colno, error);
          }
          return false;
        };
        
        // 增加超时处理
        const timeoutId = setTimeout(() => {
          window.onerror = originalOnerror; // 恢复原始错误处理
          script.remove();
          reject(new Error('Readability.js 加载超时（超过 5 秒），请检查网络连接或刷新页面'));
        }, 5000);
        
        script.onload = () => {
          debugLog('Readability.js 脚本标签 onload 事件触发');
          clearTimeout(timeoutId);
          
          // 恢复原始错误处理
          window.onerror = originalOnerror;
          
          // 检查是否有执行错误
          if (scriptError) {
            reject(new Error(`Readability.js 执行时出错: ${scriptError.message} (行 ${scriptError.lineno})`));
            return;
          }
          
          // 尝试手动触发 Readability 的初始化
          // 如果脚本执行了但 window.Readability 没设置，手动设置
          try {
            // 检查脚本是否真的执行了（通过检查是否有 Readability 构造函数）
            if (typeof Readability !== 'undefined' && typeof Readability === 'function') {
              debugLog('发现全局 Readability 函数，手动绑定到 window');
              window.Readability = Readability;
            }
          } catch (e) {
            debugWarn('检查全局 Readability 时出错:', e);
          }
          
          // 立即检查一次
          if (typeof window.Readability === 'function') {
            debugLog('✓ Readability 加载成功（立即检查）');
            resolve();
            return;
          }
          
          // 使用轮询方式检查，最多等待 3 秒
          let attempts = 0;
          const maxAttempts = 60; // 60 * 50ms = 3秒
          
          const checkReadability = () => {
            attempts++;
            
            // 每次检查时都尝试手动绑定（以防脚本延迟执行）
            try {
              if (typeof Readability !== 'undefined' && typeof Readability === 'function' && typeof window.Readability !== 'function') {
                debugLog('尝试手动绑定 Readability 到 window');
                window.Readability = Readability;
              }
            } catch (e) {
              // 忽略错误，继续检查
            }
            
            // 检查 window.Readability
            if (typeof window.Readability === 'function') {
                debugLog('✓ Readability 加载成功（通过 script 标签，轮询检查）');
              resolve();
              return;
            }
            
            if (attempts >= maxAttempts) {
              // 最后一次尝试：直接检查脚本内容
              console.error('Readability 加载失败详情:', {
                windowReadability: typeof window.Readability,
                windowReadabilityValue: window.Readability,
                globalReadability: typeof Readability,
                globalReadabilityValue: Readability,
                scriptUrl: scriptUrl,
                scriptReadyState: script.readyState,
                scriptSrc: script.src,
                scriptInDOM: document.contains(script),
                windowType: typeof window,
                hasWindow: !!window
              });
              
              // 最后尝试：如果 Readability 存在但类型不对，尝试修复
              if (typeof Readability !== 'undefined') {
                debugWarn('Readability 存在但类型不是 function:', typeof Readability);
              }
              
              reject(new Error('Readability 加载失败：window.Readability 不是函数。脚本可能未正确执行。请检查浏览器控制台是否有 JavaScript 错误，或刷新页面后重试。'));
              return;
            }
            
            setTimeout(checkReadability, 50);
          };
          
          // 延迟一下再开始检查，给脚本执行时间
          setTimeout(checkReadability, 100);
        };
        
        script.onerror = (error) => {
          clearTimeout(timeoutId);
          window.onerror = originalOnerror; // 恢复原始错误处理
          console.error('Readability.js 脚本标签加载错误:', error);
          console.error('错误详情:', {
            scriptSrc: script.src,
            scriptUrl: scriptUrl,
            error: error,
            scriptElement: script
          });
          reject(new Error('Readability.js 文件加载失败，请检查扩展文件是否完整。URL: ' + scriptUrl));
        };
        
        // 添加到 head
        (document.head || document.documentElement).appendChild(script);
        debugLog('Readability.js script 标签已添加到 DOM');
      });
    },


    createFloatingPanel() {
      const id = 'cr-floating-panel';
      if (document.getElementById(id)) return;

      const div = document.createElement('div');
      div.id = id;
      
      const shadow = div.attachShadow({ mode: 'open' });
      
      const styleLink = document.createElement('link');
      styleLink.rel = 'stylesheet';
      styleLink.href = chrome.runtime.getURL('src/ui.css');
      shadow.appendChild(styleLink);

      const container = document.createElement('div');
      container.className = 'cr-panel';
      container.innerHTML = `
        <div class="cr-header">
          <span class="cr-logo">📝 Cloze Reading</span>
          <div style="display:flex; gap:8px; align-items:center;">
            <select id="cr-language" style="padding: 2px 6px; border-radius: 6px; background: rgba(15,23,42,0.8); border: 1px solid rgba(148,163,184,0.6); color: #e5e7eb; font-size: 12px;">
              <option value="zh">中文</option>
              <option value="en">EN</option>
            </select>
            <button class="cr-close" id="btn-settings" title="设置" style="font-size:16px;">⚙️</button>
            <button class="cr-close" id="btn-close" title="关闭">×</button>
          </div>
        </div>
        <div class="cr-body">
          <div class="cr-status"></div>
          <div class="cr-progress" style="display:none">
            <div class="cr-bar"><div class="cr-bar-inner" style="width:0%"></div></div>
            <span class="cr-count">0/0</span>
          </div>
          <div class="cr-actions">
            <button id="btn-generate" class="cr-btn primary">开始生成</button>
            <button id="btn-submit" class="cr-btn success" style="display:none" disabled>提交答案</button>
            <button id="btn-reset" class="cr-btn warning" style="display:none">恢复原文</button>
          </div>
          <div id="cr-settings" class="cr-settings" style="display:none; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
            <div style="margin-bottom: 10px;">
              <label for="cr-api-provider-label" style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">API 提供者</label>
              <select id="cr-api-provider" style="width: 100%; padding: 6px; border-radius: 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #f1f5f9; font-size: 13px;">
                <option value="ollama">Ollama (本地)</option>
                <option value="google">Google AI Studio</option>
                <option value="dashscope">阿里云通义千问</option>
              </select>
            </div>
            
            <!-- Ollama 配置 -->
            <div id="cr-ollama-config" style="margin-bottom: 10px;">
              <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Ollama Base URL</label>
              <input id="cr-ollama-url" type="text" placeholder="http://localhost:11434" style="width: 100%; padding: 6px; border-radius: 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #f1f5f9; font-size: 13px; margin-bottom: 6px;" />
              <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">模型名称</label>
              <input id="cr-ollama-model" type="text" placeholder="qwen2.5:7b (示例: qwen2.5:7b, llama3:8b)" style="width: 100%; padding: 6px; border-radius: 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #f1f5f9; font-size: 13px;" />
              <div style="font-size: 11px; color: #64748b; margin-top: 4px;">格式: 模型名:版本 (如: qwen2.5:7b, llama3:8b)</div>
            </div>

            <!-- Google 配置 -->
            <div id="cr-google-config" style="display: none; margin-bottom: 10px;">
              <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">API Key</label>
              <input id="cr-google-key" type="password" placeholder="输入 Google AI Studio API Key" style="width: 100%; padding: 6px; border-radius: 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #f1f5f9; font-size: 13px; margin-bottom: 6px;" />
              <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">模型名称</label>
              <input id="cr-google-model" type="text" placeholder="gemini-2.5-flash (示例: gemini-2.5-flash, gemini-1.5-pro)" style="width: 100%; padding: 6px; border-radius: 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #f1f5f9; font-size: 13px;" />
              <div style="font-size: 11px; color: #64748b; margin-top: 4px;">格式: gemini-版本-类型 (如: gemini-2.5-flash, gemini-1.5-pro)</div>
            </div>

            <!-- DashScope 配置 -->
            <div id="cr-dashscope-config" style="display: none; margin-bottom: 10px;">
              <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">API Key</label>
              <input id="cr-dashscope-key" type="password" placeholder="sk-..." style="width: 100%; padding: 6px; border-radius: 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #f1f5f9; font-size: 13px; margin-bottom: 6px;" />
              <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">模型名称</label>
              <input id="cr-dashscope-model" type="text" placeholder="qwen-plus (示例: qwen-turbo, qwen-plus, qwen-max, qwen-long)" style="width: 100%; padding: 6px; border-radius: 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #f1f5f9; font-size: 13px;" />
              <div style="font-size: 11px; color: #64748b; margin-top: 4px;">格式: qwen-类型 (如: qwen-turbo, qwen-plus, qwen-max, qwen-long)</div>
            </div>

            <button id="btn-save-settings" class="cr-btn primary" style="width: 100%; margin-top: 8px;">保存设置</button>
          </div>
        </div>
      `;

      shadow.appendChild(container);
      
      // 确保面板可见
      div.style.display = 'block';
      div.style.visibility = 'visible';
      div.style.opacity = '1';
      
      document.body.appendChild(div);

      const btnGenerate = shadow.getElementById('btn-generate');
      const btnSubmit = shadow.getElementById('btn-submit');
      const btnReset = shadow.getElementById('btn-reset');
      const btnClose = shadow.getElementById('btn-close');
      const btnSettings = shadow.getElementById('btn-settings');

      btnGenerate.onclick = () => this.startGeneration();
      btnSubmit.onclick = () => this.handleSubmit();
      btnReset.onclick = () => this.restoreOriginal();
      
      btnClose.onclick = () => {
        // 只隐藏面板，不删除，保留状态以便再次打开时继续
        div.style.display = 'none';
      };

      btnSettings.onclick = () => {
        const settingsPanel = shadow.getElementById('cr-settings');
        if (settingsPanel.style.display === 'none') {
          settingsPanel.style.display = 'block';
          this.loadSettingsToPanel(shadow);
        } else {
          settingsPanel.style.display = 'none';
        }
      };

      // API 提供者切换
      shadow.getElementById('cr-api-provider').addEventListener('change', (e) => {
        const provider = e.target.value;
        const ollamaConfig = shadow.getElementById('cr-ollama-config');
        const googleConfig = shadow.getElementById('cr-google-config');
        const dashscopeConfig = shadow.getElementById('cr-dashscope-config');
        
        ollamaConfig.style.display = 'none';
        googleConfig.style.display = 'none';
        dashscopeConfig.style.display = 'none';

        if (provider === 'ollama') {
          ollamaConfig.style.display = 'block';
        } else if (provider === 'google') {
          googleConfig.style.display = 'block';
        } else if (provider === 'dashscope') {
          dashscopeConfig.style.display = 'block';
        }
      });

      // 语言切换
      shadow.getElementById('cr-language').addEventListener('change', (e) => {
        this.state.language = e.target.value;
        this.applyLanguage(shadow);

        // 语言切换后，重新渲染当前状态文案
        const statusEl = shadow.querySelector('.cr-status');
        if (statusEl) {
          const text = this.state.statusKey
            ? this.t(this.state.statusKey, this.state.statusParams || {})
            : (this.state.statusText || '');
          statusEl.textContent = text;
        }
      });

      // 保存设置
      shadow.getElementById('btn-save-settings').addEventListener('click', () => {
        this.saveSettingsFromPanel(shadow);
      });

      // 设置语言选择器的默认值
      const langSelect = shadow.getElementById('cr-language');
      if (langSelect) {
        langSelect.value = this.state.language || 'zh';
      }

      // 应用语言（确保按钮和界面文本正确）
      this.applyLanguage(shadow);

      // 初始化状态文本
      this.updateStatusKey('status.statusReady');
    },

    handleSubmit() {
      const panel = document.getElementById('cr-floating-panel');
      if (!panel || !panel.shadowRoot) {
        console.error('浮动面板不存在，无法提交答案');
        return;
      }
      const shadow = panel.shadowRoot;

      let correctCount = 0;
      let totalCount = 0;
      
      document.querySelectorAll('select.cr-select').forEach(select => {
        totalCount++;
        const userAnswer = select.value;
        const correctAnswer = select.dataset.answer;
        const analysis = select.dataset.analysis || '';
        
        const parent = select.parentElement; 
        
        if (userAnswer === correctAnswer) {
          select.classList.add('correct');
          parent.classList.add('correct');
          correctCount++;
        } else {
          select.classList.add('wrong');
          parent.classList.add('wrong');
          
          if (!parent.querySelector('.cr-feedback')) {
            const feedback = document.createElement('span');
            feedback.className = 'cr-feedback';
            feedback.innerHTML = ` ✅ ${correctAnswer} <br> 💡 ${analysis}`;
            parent.appendChild(feedback);
          }
        }
        select.disabled = true; 
      });
      
      this.updateStatusKey('status.score', { correct: correctCount, total: totalCount });
      shadow.getElementById('btn-submit').style.display = 'none';
      shadow.getElementById('btn-reset').style.display = 'inline-block';
    },

    updateStatus(text, progress = null, meta = null) {
      // 记录当前状态，便于语言切换时重新渲染
      if (meta && Object.prototype.hasOwnProperty.call(meta, 'key')) {
        this.state.statusKey = meta.key;
        this.state.statusParams = meta.params || {};
      } else {
        this.state.statusKey = null;
        this.state.statusParams = null;
      }
      this.state.statusText = text;

      const panel = document.getElementById('cr-floating-panel');
      if (!panel || !panel.shadowRoot) {
        // 如果面板不存在，只输出到控制台，不抛出错误
        debugLog('[状态更新]', text);
        return;
      }
      const shadow = panel.shadowRoot;
      
      const statusElement = shadow.querySelector('.cr-status');
      if (statusElement) {
        statusElement.textContent = text;
      }
      
      if (progress) {
        const { current, total } = progress;
        const pct = total === 0 ? 0 : Math.round((current / total) * 100);
        const progressElement = shadow.querySelector('.cr-progress');
        const barInner = shadow.querySelector('.cr-bar-inner');
        const countElement = shadow.querySelector('.cr-count');
        if (progressElement) progressElement.style.display = 'flex';
        if (barInner) barInner.style.width = `${pct}%`;
        if (countElement) countElement.textContent = `${current}/${total}`;
      }
    },

    // 基于 key 的状态更新，便于在语言切换时重新渲染
    updateStatusKey(key, params = {}, progress = null) {
      const text = this.t(key, params);
      this.updateStatus(text, progress, { key, params });
    },

    async parseDocument() {
      const paragraphs = [];
      let idCounter = 0;
      const processedElements = new Set();

      function countWords(text) {
        const cleaned = text.replace(/[，。！？、；：""''（）【】《》\s]+/g, ' ');
        const chineseChars = (cleaned.match(/[\u4e00-\u9fa5]/g) || []).length;
        const englishWords = cleaned.trim().split(/\s+/).filter(w => w.length > 0 && !/[\u4e00-\u9fa5]/.test(w)).length;
        return Math.ceil(chineseChars / 2) + englishWords;
      }

      function shouldProcessElement(el) {
        if (el.offsetParent === null) return false;
        if (el.closest('#cr-floating-panel')) return false;
        if (el.closest('pre') || el.closest('code')) return false;
        if (processedElements.has(el)) return false;
        const tagName = el.tagName?.toLowerCase();
        const className = el.className?.toLowerCase() || '';
        const id = el.id?.toLowerCase() || '';
        if (tagName === 'nav' || tagName === 'header' || tagName === 'footer' || 
            className.includes('nav') || className.includes('sidebar') || 
            className.includes('menu') || id.includes('nav') || id.includes('sidebar')) {
          return false;
        }
        return true;
      }

      // 使用 Readability 算法提取正文（完全依赖，无兜底策略）
      let readabilityParagraphs = [];
      
      // 确保 Readability 已加载
      if (typeof window.Readability === 'undefined' || typeof window.Readability !== 'function') {
        await this.loadReadability();
      }
      
      if (typeof window.Readability !== 'function') {
        throw new Error('Readability 加载失败，无法识别正文内容');
      }
      
      // 创建一个新的 document 来执行 Readability，避免修改原始页面
      // 使用 document.implementation.createHTMLDocument 创建独立的 document
      const clonedDoc = document.implementation.createHTMLDocument('Cloned Document');
      clonedDoc.documentElement.innerHTML = document.documentElement.innerHTML;
      
      // 复制 body 内容
      if (document.body && clonedDoc.body) {
        clonedDoc.body.innerHTML = document.body.innerHTML;
      }
      
      // 使用克隆的 document 来执行 Readability，这样不会修改原始页面
      const reader = new window.Readability(clonedDoc, {
        debug: false,
        maxElemsToParse: 0,
        nbTopCandidates: 5,
        charThreshold: 500
      });
      
      const article = reader.parse();
      if (!article || !article.content) {
        throw new Error('Readability 无法识别正文内容，请确认当前页面包含可识别的文章内容');
      }
      
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = article.content;
      readabilityParagraphs = Array.from(tempDiv.querySelectorAll('p'));
      debugLog(`[Readability] 提取到 ${readabilityParagraphs.length} 个段落`);
      debugLog(`[Readability] 文章标题: ${article.title || '无'}`);
      debugLog(`[Readability] 文章长度: ${article.length || 0} 字符`);
      
      if (readabilityParagraphs.length === 0) {
        throw new Error('Readability 未提取到任何段落，无法生成题目');
      }

      // 通过 Readability 结果，在原始 DOM 中找到对应段落
      debugLog(`[正文提取] 开始匹配 Readability 提取的 ${readabilityParagraphs.length} 个段落到原始 DOM`);
      const allOriginalPTags = document.querySelectorAll('p');
      let matchedCount = 0;
      
      readabilityParagraphs.forEach((readabilityP, index) => {
        const text = readabilityP.innerText.trim();
        if (text.length < 10 || !/[，。！？]/.test(text)) return;
        
        const wordCount = countWords(text);
        if (wordCount < 15) return;
        
        // 在原始 DOM 中查找匹配的段落
        for (const originalP of allOriginalPTags) {
          if (processedElements.has(originalP)) continue;
          if (!shouldProcessElement(originalP)) continue;
          
          const originalText = originalP.innerText.trim();
          // 简单匹配：文本相同或包含关系
          if (originalText === text || originalText.includes(text) || text.includes(originalText)) {
            const id = `cr-p-${idCounter++}`;
            originalP.setAttribute('data-cr-id', id);
            processedElements.add(originalP);
            
            paragraphs.push({
              id, element: originalP, originalHTML: originalP.innerHTML, text: originalText, status: 'pending'
            });
            matchedCount++;
            debugLog(`[正文提取] 段落 ${index + 1}/${readabilityParagraphs.length} 匹配成功:`, originalText.substring(0, 50) + '...');
            break;
          }
        }
      });
      
      debugLog(`[正文提取] Readability 匹配完成: ${matchedCount}/${readabilityParagraphs.length} 个段落成功匹配`);
      
      if (paragraphs.length === 0) {
        throw new Error('Readability 提取的段落无法匹配到页面中的原始内容，无法生成题目');
      }

      debugLog(`[正文提取] 最终结果: 共找到 ${paragraphs.length} 个段落`);
      return paragraphs;
    },

    async restoreOriginal() {
      this.state.paragraphs.forEach(p => {
        if (p.element) {
          p.element.innerHTML = p.originalHTML;
          p.element.removeAttribute('data-cr-id');
          p.element.classList.remove('cr-paragraph-processed');
        }
      });
      
      const panel = document.getElementById('cr-floating-panel');
      if (panel && panel.shadowRoot) {
        const shadow = panel.shadowRoot;
        const btnGenerate = shadow.getElementById('btn-generate');
        const btnSubmit = shadow.getElementById('btn-submit');
        const btnReset = shadow.getElementById('btn-reset');
        const progressElement = shadow.querySelector('.cr-progress');
        if (btnGenerate) btnGenerate.style.display = 'inline-block';
        if (btnSubmit) btnSubmit.style.display = 'none';
        if (btnReset) btnReset.style.display = 'none';
        if (progressElement) progressElement.style.display = 'none';
        
        let config;
        try {
          config = await safeStorageGet(['apiProvider']);
        } catch (e) {
        this.updateStatusKey('status.contextInvalid');
          return;
        }
        const apiProvider = config.apiProvider || 'ollama';
        this.updateStatusKey('status.restored', { provider: getProviderName(apiProvider) });
      }
      this.state.paragraphs = [];
    },

    async startGeneration() {
      // 确保面板存在
      let panel = document.getElementById('cr-floating-panel');
      if (!panel) {
        debugLog('浮动面板不存在，正在创建...');
        this.createFloatingPanel();
        panel = document.getElementById('cr-floating-panel');
      }
      
      if (!panel || !panel.shadowRoot) {
        console.error('浮动面板创建失败，无法开始生成');
        this.updateStatusKey('status.contextInvalidWithRetry');
        return;
      }
      const shadow = panel.shadowRoot;

      // 记录开始时间
      this.state.generationStartTime = performance.now();
      
      let config;
      try {
        config = await safeStorageGet(['apiProvider', 'ollamaModel', 'googleModel', 'dashscopeModel']);
      } catch (e) {
        if (e.message) {
          this.updateStatus(e.message);
        } else {
          this.updateStatusKey('status.contextInvalid');
        }
        return;
      }
      const apiProvider = config.apiProvider || 'ollama';
      
      this.state.model = getModelFromConfig(config, apiProvider);
      this.updateStatusKey('status.checkingConnection', { provider: getProviderName(apiProvider) });
      let check;
      try {
        check = await safeSendMessage({ 
          type: 'CHECK_API_STATUS', 
          model: this.state.model 
        });
      } catch (e) {
        if (e.message) {
          this.updateStatus(e.message);
        } else {
          this.updateStatusKey('status.contextInvalid');
        }
        return;
      }
      
      // 防御性检查：如果 check 为 undefined，说明 Background 没有响应
      if (!check || typeof check !== 'object') {
        this.updateStatusKey('status.connectFailedUnknown');
        return;
      }

      if (!check.success) {
        this.updateStatusKey('status.connectFailedWithError', { error: check.error || 'Unknown error' });
        return;
      }
      if (apiProvider === 'ollama' && !check.modelExists) {
        this.updateStatusKey('status.modelNotReady', { model: this.state.model });
        return;
      }

      this.updateStatusKey('status.parsing');
      try {
        this.state.paragraphs = await this.parseDocument();
      } catch (error) {
        this.updateStatusKey('status.parseFailed', { error: error.message });
        console.error('[正文提取错误]', error);
        return;
      }
      
      if (this.state.paragraphs.length === 0) {
        this.updateStatusKey('status.noParagraphs');
        return;
      }

      this.state.stats = { total: this.state.paragraphs.length, done: 0, success: 0 };
      shadow.getElementById('btn-generate').style.display = 'none';
      
      this.processQueue();
    },

    async processQueue() {
      const panel = document.getElementById('cr-floating-panel');
      if (!panel || !panel.shadowRoot) {
        console.error('浮动面板不存在，无法处理队列');
        return;
      }
      const shadow = panel.shadowRoot;
      let config;
      try {
        config = await safeStorageGet(['apiProvider']);
      } catch (e) {
        if (e.message) {
          this.updateStatus(e.message);
        } else {
          this.updateStatusKey('status.contextInvalid');
        }
        return;
      }
      const apiProvider = config.apiProvider || 'ollama';
      const providerName = getProviderName(apiProvider);
      const batchSize = 10; // 每批处理的段落数量
      const totalParagraphs = this.state.paragraphs.length;
      
      // 将段落分批处理
      const batches = [];
      for (let i = 0; i < totalParagraphs; i += batchSize) {
        batches.push(this.state.paragraphs.slice(i, i + batchSize));
      }

      try {
        // 逐批处理
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          const batchStartIndex = batchIndex * batchSize;
          
          // 更新状态：显示当前批次进度
          this.updateStatusKey('status.generating', {
            provider: providerName,
            current: batchStartIndex + 1,
            total: totalParagraphs
          }, {
            current: batchStartIndex,
            total: totalParagraphs
          });

          // 调用批量 API 处理当前批次
          const response = await safeSendMessage({
            type: 'GENERATE_CLOZE_BATCH',
            paragraphs: batch.map(p => ({ id: p.id, text: p.text })),
            model: this.state.model
          });

          if (response.success && response.data) {
            // 处理当前批次的结果
            for (let i = 0; i < batch.length; i++) {
              const p = batch[i];
              const paragraphResult = response.data[p.id];
              const globalIndex = batchStartIndex + i;

              // 更新进度
              this.updateStatusKey('status.generating', {
                provider: providerName,
                current: globalIndex + 1,
                total: totalParagraphs
              }, {
                current: globalIndex,
                total: totalParagraphs
              });

              if (paragraphResult && paragraphResult.clozes && paragraphResult.clozes.length > 0) {
                this.applyClozeToParagraph(p, paragraphResult.clozes);
                this.state.stats.success++;
              }

              this.state.stats.done++;
              p.status = 'done';
            }
          } else {
            // 当前批次失败，标记该批次所有段落为失败
            for (const p of batch) {
              this.state.stats.done++;
              p.status = 'done';
            }
          }
        }
      } catch (err) {
        debugError('批量调用失败:', err);
        // 标记所有未处理的段落为失败
        for (const p of this.state.paragraphs) {
          if (p.status !== 'done') {
            this.state.stats.done++;
            p.status = 'done';
          }
        }
      }
      
      const end = performance.now();
      const durationMs = end - (this.state.generationStartTime || end);
      const seconds = (durationMs / 1000).toFixed(1);

      this.updateStatusKey('status.generatedSummary', {
        success: this.state.stats.success,
        total: this.state.stats.total,
        seconds
      }, {
        current: this.state.stats.total,
        total: this.state.stats.total
      });
      
      const btnSubmit = shadow.getElementById('btn-submit');
      if (btnSubmit) {
        btnSubmit.style.display = 'inline-block';
        btnSubmit.disabled = false;
      }
    },

    applyClozeToParagraph(paragraphObj, clozes) {
      const el = paragraphObj.element;
      
      // 去重：如果多个挖空有相同的 target，只保留第一个
      const seenTargets = new Set();
      const uniqueClozes = clozes.filter(cloze => {
        if (seenTargets.has(cloze.target)) {
          debugWarn(`[去重] 跳过重复的 target: ${cloze.target}`);
          return false;
        }
        seenTargets.add(cloze.target);
        return true;
      });
      
      // 按长度从长到短排序，避免短词包含在长词中导致替换错误
      uniqueClozes.sort((a, b) => b.target.length - a.target.length);

      // 记录已替换的位置，避免重复替换
      const replacedRanges = [];
      
      uniqueClozes.forEach((cloze, index) => {
        const optionsHtml = cloze.options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
        
        const selectId = `${paragraphObj.id}-sel-${index}`;
        const safeAnalysis = (cloze.analysis || '').replace(/"/g, '&quot;');
        const safeAnswer = (cloze.answer || '').replace(/"/g, '&quot;');
        
        const selectHtml = `
          <span class="cr-cloze-wrapper">
            <select class="cr-select" id="${selectId}" data-answer="${safeAnswer}" data-analysis="${safeAnalysis}">
              <option value="" disabled selected>&nbsp;</option>
              ${optionsHtml}
            </select>
          </span>
        `;

        const replaced = this.replaceTextInNode(el, cloze.target, selectHtml, replacedRanges);
        if (replaced) {
          debugLog(`[替换成功] ${cloze.target} -> 下拉框 ${index + 1}`);
        } else {
          debugWarn(`[替换失败] 未找到或已替换: ${cloze.target}`);
        }
      });
      
      el.classList.add('cr-paragraph-processed');
    },

    replaceTextInNode(rootNode, targetText, replacementHtml, replacedRanges = []) {
      // 获取段落的完整文本内容，检查是否已经包含这个 target
      const paragraphText = rootNode.textContent || '';
      
      // 检查这个 target 是否已经被替换过（通过检查段落中是否已经有对应的下拉框）
      const existingSelects = rootNode.querySelectorAll('select.cr-select');
      for (const select of existingSelects) {
        const answer = select.dataset.answer;
        if (answer === targetText) {
          debugWarn(`[跳过] ${targetText} 已经被替换过了`);
          return false;
        }
      }
      
      const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
      let targetNode = null;
      let targetIndex = -1;
      let nodeStartOffset = 0; // 记录当前节点在整个段落中的起始位置
      
      while(walker.nextNode()) {
        const currentNode = walker.currentNode;
        
        // 跳过已经在 select 元素内的文本节点（避免重复替换）
        if (currentNode.parentElement && currentNode.parentElement.closest('select.cr-select')) {
          nodeStartOffset += currentNode.nodeValue.length;
          continue;
        }
        
        // 跳过已经在 cr-cloze-wrapper 内的文本节点
        if (currentNode.parentElement && currentNode.parentElement.closest('.cr-cloze-wrapper')) {
          nodeStartOffset += currentNode.nodeValue.length;
          continue;
        }
        
        // 检查是否包含目标文本，并找到第一次出现的位置
        const index = currentNode.nodeValue.indexOf(targetText);
        if (index !== -1) {
          const globalIndex = nodeStartOffset + index;
          
          // 检查这个位置是否与已替换的范围重叠
          const overlaps = replacedRanges.some(range => {
            return globalIndex < range.end && (globalIndex + targetText.length) > range.start;
          });
          
          if (!overlaps) {
            targetNode = currentNode;
            targetIndex = index;
            // 记录替换范围
            replacedRanges.push({
              start: globalIndex,
              end: globalIndex + targetText.length,
              target: targetText
            });
            break; // 只替换第一次出现
          }
        }
        
        nodeStartOffset += currentNode.nodeValue.length;
      }

      if (targetNode && targetIndex !== -1) {
        const nodeValue = targetNode.nodeValue;
        const beforeText = nodeValue.substring(0, targetIndex);
        const afterText = nodeValue.substring(targetIndex + targetText.length);
        
        const fragment = document.createDocumentFragment();
        
        // 添加替换前的文本
        if (beforeText) {
          fragment.appendChild(document.createTextNode(beforeText));
        }
        
        // 添加替换的 HTML（下拉框）
        const temp = document.createElement('span');
        temp.innerHTML = replacementHtml;
        while (temp.firstChild) {
          fragment.appendChild(temp.firstChild);
        }
        
        // 添加替换后的文本
        if (afterText) {
          fragment.appendChild(document.createTextNode(afterText));
        }
        
        targetNode.parentNode.replaceChild(fragment, targetNode);
        return true; // 返回 true 表示替换成功
      }
      
      return false; // 返回 false 表示未找到或已替换
    },

    async loadSettingsToPanel(shadow) {
      let settings;
      try {
        settings = await safeStorageGet(['apiProvider', 'ollamaBaseUrl', 'ollamaModel', 'googleApiKey', 'googleModel', 'dashscopeApiKey', 'dashscopeModel', 'language']);
      } catch (e) {
        if (e.message) {
          this.updateStatus(e.message);
        } else {
          this.updateStatusKey('status.contextInvalid');
        }
        return;
      }
      
      const apiProvider = settings.apiProvider || 'ollama';
      shadow.getElementById('cr-api-provider').value = apiProvider;
      
      // 保持当前语言设置，不从存储中覆盖（维持现状）
      // 如果当前 state.language 没有值，才从存储中读取
      if (!this.state.language) {
        this.state.language = settings.language || 'zh';
      }
      const langSelect = shadow.getElementById('cr-language');
      if (langSelect) langSelect.value = this.state.language;
      
      // 更新可见性
      shadow.getElementById('cr-ollama-config').style.display = 'none';
      shadow.getElementById('cr-google-config').style.display = 'none';
      shadow.getElementById('cr-dashscope-config').style.display = 'none';

      if (apiProvider === 'ollama') {
        shadow.getElementById('cr-ollama-config').style.display = 'block';
      } else if (apiProvider === 'google') {
        shadow.getElementById('cr-google-config').style.display = 'block';
      } else if (apiProvider === 'dashscope') {
        shadow.getElementById('cr-dashscope-config').style.display = 'block';
      }

      // 填充值
      shadow.getElementById('cr-ollama-url').value = settings.ollamaBaseUrl || 'http://localhost:11434';
      shadow.getElementById('cr-ollama-model').value = settings.ollamaModel || 'qwen2.5:7b';
      shadow.getElementById('cr-google-key').value = settings.googleApiKey || '';
      shadow.getElementById('cr-google-model').value = settings.googleModel || 'gemini-2.5-flash';
      shadow.getElementById('cr-dashscope-key').value = settings.dashscopeApiKey || '';
      shadow.getElementById('cr-dashscope-model').value = settings.dashscopeModel || 'qwen-plus';

      // 应用语言
      this.applyLanguage(shadow);
    },

    async saveSettingsFromPanel(shadow) {
      const apiProvider = shadow.getElementById('cr-api-provider').value;
      const language = shadow.getElementById('cr-language').value || 'zh';
      const settings = { apiProvider, language };
      this.state.language = language;
      
      // 根据 provider 读取对应配置
      const configMap = {
        ollama: {
          baseUrl: shadow.getElementById('cr-ollama-url'),
          model: shadow.getElementById('cr-ollama-model'),
          required: ['model'],
          messages: { model: '请输入 Ollama 模型名' }
        },
        google: {
          apiKey: shadow.getElementById('cr-google-key'),
          model: shadow.getElementById('cr-google-model'),
          required: ['apiKey', 'model'],
          messages: { apiKey: '请输入 Google AI Studio API Key', model: '请输入模型名称' }
        },
        dashscope: {
          apiKey: shadow.getElementById('cr-dashscope-key'),
          model: shadow.getElementById('cr-dashscope-model'),
          required: ['apiKey', 'model'],
          messages: { apiKey: '请输入 DashScope API Key', model: '请输入模型名称' }
        }
      };
      
      const config = configMap[apiProvider];
      if (!config) {
        this.updateStatusKey('status.unknownProvider');
        return;
      }
      
      // 读取并验证配置
      if (config.baseUrl) {
        settings[`${apiProvider}BaseUrl`] = config.baseUrl.value.trim() || 'http://localhost:11434';
      }
      if (config.apiKey) {
        settings[`${apiProvider}ApiKey`] = config.apiKey.value.trim();
      }
      if (config.model) {
        settings[`${apiProvider}Model`] = config.model.value.trim();
      }
      
      // 验证必填项
      for (const field of config.required) {
        const value = field === 'apiKey' ? settings[`${apiProvider}ApiKey`] : settings[`${apiProvider}Model`];
        if (!value) {
          this.updateStatus(config.messages[field]);
          return;
        }
      }
      
      try {
        await safeStorageSet(settings);
        this.state.model = getModelFromConfig(settings, apiProvider);
        this.updateStatusKey('status.settingsSaved');
        setTimeout(() => {
          shadow.getElementById('cr-settings').style.display = 'none';
        }, 1000);
      } catch (e) {
        this.updateStatus(e.message || '保存失败，请刷新页面后重试');
      }
    }
  };
}

// 统一执行启动逻辑
if (window.ClozeReadingApp) {
  const existingPanel = document.getElementById('cr-floating-panel');
  if (!existingPanel) {
    // 面板不存在，初始化
    debugLog('[启动] 面板不存在，初始化新面板');
    window.ClozeReadingApp.init();
  } else {
    // 面板已存在，显示它并恢复状态
    debugLog('[启动] 面板已存在，显示并恢复状态');
    existingPanel.style.display = 'block';
    existingPanel.style.visibility = 'visible';
    existingPanel.style.opacity = '1';
    
    const shadow = existingPanel.shadowRoot;
    if (!shadow) {
      // 如果 shadowRoot 不存在，重新初始化
      debugWarn('[启动] 面板存在但 shadowRoot 丢失，重新初始化');
      existingPanel.remove();
      window.ClozeReadingApp.init();
    } else {
      // 确保应用语言设置
      window.ClozeReadingApp.applyLanguage(shadow);
      
      // 检查是否有已生成的题目（通过检查页面中是否有 select.cr-select）
      const hasClozes = document.querySelectorAll('select.cr-select').length > 0;
      if (hasClozes) {
        // 如果有题目，显示提交按钮
        const btnGenerate = shadow.getElementById('btn-generate');
        const btnSubmit = shadow.getElementById('btn-submit');
        const btnReset = shadow.getElementById('btn-reset');
        if (btnGenerate) btnGenerate.style.display = 'none';
        if (btnSubmit) {
          btnSubmit.style.display = 'inline-block';
          btnSubmit.disabled = false;
        }
        if (btnReset) btnReset.style.display = 'inline-block';
        window.ClozeReadingApp.updateStatusKey('status.canContinue');
      } else {
        // 没有题目，显示生成按钮
        const btnGenerate = shadow.getElementById('btn-generate');
        const btnSubmit = shadow.getElementById('btn-submit');
        const btnReset = shadow.getElementById('btn-reset');
        if (btnGenerate) btnGenerate.style.display = 'inline-block';
        if (btnSubmit) btnSubmit.style.display = 'none';
        if (btnReset) btnReset.style.display = 'none';
        window.ClozeReadingApp.updateStatusKey('status.statusReady');
      }
    }
  }
}
