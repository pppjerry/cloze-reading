// src/content.js
// Cloze-Reading v2.0 Content Script

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
      stats: { total: 0, done: 0, success: 0 }
    },
    
    async init() {
      this.injectGlobalStyles();
      this.createFloatingPanel();
      this.setupMessageListener();
      
      try {
        const config = await safeStorageGet(['apiProvider', 'ollamaModel', 'googleModel', 'dashscopeModel']);
        const apiProvider = config.apiProvider || 'ollama';
        this.state.model = getModelFromConfig(config, apiProvider);
      } catch (e) {
        this.updateStatus('扩展上下文失效，请刷新页面');
      }
    },

    setupMessageListener() {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'LOG') {
          const { level = 'log', args = [] } = request;
          if (level === 'error') {
            console.error(...args);
          } else if (level === 'warn') {
            console.warn(...args);
          } else {
            console.log(...args);
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
      return new Promise((resolve, reject) => {
        // 如果已经加载，直接返回
        if (typeof window.Readability !== 'undefined' && typeof window.Readability === 'function') {
          resolve();
          return;
        }

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('src/vendor/readability/Readability.js');
        
        script.onload = () => {
          // 延迟一下，确保脚本完全执行
          setTimeout(() => {
            if (typeof window.Readability === 'function') {
              console.log('✓ Readability 加载成功');
              resolve();
            } else {
              reject(new Error('Readability 加载失败：window.Readability 不是函数'));
            }
          }, 50);
        };
        
        script.onerror = (error) => {
          reject(new Error('Readability.js 文件加载失败: ' + error));
        };
        
        document.head.appendChild(script);
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
          <div style="display:flex; gap:8px;">
            <button class="cr-close" id="btn-settings" title="设置" style="font-size:16px;">⚙️</button>
            <button class="cr-close" id="btn-close" title="关闭">×</button>
          </div>
        </div>
        <div class="cr-body">
          <div class="cr-status">准备就绪</div>
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
              <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">API 提供者</label>
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

      // 保存设置
      shadow.getElementById('btn-save-settings').addEventListener('click', () => {
        this.saveSettingsFromPanel(shadow);
      });
    },

    handleSubmit() {
      const panel = document.getElementById('cr-floating-panel');
      if (!panel) return;
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
      
      this.updateStatus(`得分: ${correctCount} / ${totalCount}`);
      shadow.getElementById('btn-submit').style.display = 'none';
      shadow.getElementById('btn-reset').style.display = 'inline-block';
    },

    updateStatus(text, progress = null) {
      const panel = document.getElementById('cr-floating-panel');
      if (!panel) return;
      const shadow = panel.shadowRoot;
      
      shadow.querySelector('.cr-status').textContent = text;
      
      if (progress) {
        const { current, total } = progress;
        const pct = total === 0 ? 0 : Math.round((current / total) * 100);
        shadow.querySelector('.cr-progress').style.display = 'flex';
        shadow.querySelector('.cr-bar-inner').style.width = `${pct}%`;
        shadow.querySelector('.cr-count').textContent = `${current}/${total}`;
      }
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

      // 使用 Readability 算法提取正文
      let readabilityParagraphs = [];
      
      try {
        if (typeof window.Readability === 'undefined' || typeof window.Readability !== 'function') {
          await this.loadReadability();
        }
        
        if (typeof window.Readability === 'function') {
          const reader = new window.Readability(document, {
            debug: false,
            maxElemsToParse: 0,
            nbTopCandidates: 5,
            charThreshold: 500
          });
          
          const article = reader.parse();
          if (article && article.content) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = article.content;
            readabilityParagraphs = Array.from(tempDiv.querySelectorAll('p'));
            console.log(`[Readability] 提取到 ${readabilityParagraphs.length} 个段落`);
            console.log(`[Readability] 文章标题: ${article.title || '无'}`);
            console.log(`[Readability] 文章长度: ${article.length || 0} 字符`);
          } else {
            console.warn('[Readability] 未提取到内容');
          }
        }
      } catch (err) {
        console.warn('Readability 提取失败，使用兜底策略:', err);
      }

      // 通过 Readability 结果，在原始 DOM 中找到对应段落
      if (readabilityParagraphs.length > 0) {
        console.log(`[正文提取] 开始匹配 Readability 提取的 ${readabilityParagraphs.length} 个段落到原始 DOM`);
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
              const id = `cr-p-${Date.now()}-${idCounter++}`;
              originalP.setAttribute('data-cr-id', id);
              processedElements.add(originalP);
              
              paragraphs.push({
                id, element: originalP, originalHTML: originalP.innerHTML, text: originalText, status: 'pending'
              });
              matchedCount++;
              console.log(`[正文提取] 段落 ${index + 1}/${readabilityParagraphs.length} 匹配成功:`, originalText.substring(0, 50) + '...');
              break;
            }
          }
        });
        
        console.log(`[正文提取] Readability 匹配完成: ${matchedCount}/${readabilityParagraphs.length} 个段落成功匹配`);
      }

      // 兜底策略：如果 Readability 没有找到足够段落，使用固定选择器
      if (paragraphs.length === 0) {
        console.log('[正文提取] Readability 未找到段落，使用兜底策略');
        let mainContentArea = null;
        const articleSelectors = [
          'article', '[role="article"]', '.article', '.content', '.post-content', '.entry-content', 'main', '[role="main"]'
        ];
        
        for (const selector of articleSelectors) {
          const found = document.querySelector(selector);
          if (found && found.offsetParent !== null) {
            mainContentArea = found;
            console.log(`[正文提取] 找到主内容区域: ${selector}`);
            break;
          }
        }

        const pTags = mainContentArea ? mainContentArea.querySelectorAll('p') : document.querySelectorAll('p');
        console.log(`[正文提取] 找到 ${pTags.length} 个 <p> 标签`);
        
        pTags.forEach(el => {
          if (!shouldProcessElement(el)) return;
          if (processedElements.has(el)) return;
          if (mainContentArea && !mainContentArea.contains(el)) return;
          
          const text = el.innerText.trim();
          if (text.length < 10) return;
          if (!/[，。！？]/.test(text)) return;
          
          const wordCount = countWords(text);
          if (wordCount < 15) return;

          const id = `cr-p-${Date.now()}-${idCounter++}`;
          el.setAttribute('data-cr-id', id);
          processedElements.add(el);
          
          paragraphs.push({
            id, element: el, originalHTML: el.innerHTML, text: text, status: 'pending'
          });
          console.log(`[正文提取] 段落 ${paragraphs.length}:`, text.substring(0, 50) + '...');
        });
        
        console.log(`[正文提取] 兜底策略完成: 找到 ${paragraphs.length} 个有效段落`);
      }

      // 补充处理：处理其他标签（如果前面没有找到足够段落）
      if (paragraphs.length === 0) {
        console.log('[正文提取] 使用补充策略：处理其他标签');
        const otherTags = document.querySelectorAll('div, li, blockquote');
        console.log(`[正文提取] 找到 ${otherTags.length} 个其他标签`);
        
        otherTags.forEach((el, index) => {
          if (!shouldProcessElement(el) || processedElements.has(el)) return;
          if (Array.from(el.querySelectorAll('p')).some(p => processedElements.has(p))) return;
          
          const text = el.innerText.trim();
          if (text.length < 10 || !/[，。！？]/.test(text)) return;
          
          const wordCount = countWords(text);
          if (wordCount < 15) return;

          const id = `cr-p-${Date.now()}-${idCounter++}`;
          el.setAttribute('data-cr-id', id);
          processedElements.add(el);
          
          paragraphs.push({
            id, element: el, originalHTML: el.innerHTML, text: text, status: 'pending'
          });
          console.log(`[正文提取] 补充段落 ${paragraphs.length}:`, text.substring(0, 50) + '...');
        });
        
        console.log(`[正文提取] 补充策略完成: 找到 ${paragraphs.length} 个有效段落`);
      }

      console.log(`[正文提取] 最终结果: 共找到 ${paragraphs.length} 个段落`);
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
      if (panel) {
        const shadow = panel.shadowRoot;
        shadow.getElementById('btn-generate').style.display = 'inline-block';
        shadow.getElementById('btn-submit').style.display = 'none';
        shadow.getElementById('btn-reset').style.display = 'none';
        shadow.querySelector('.cr-progress').style.display = 'none';
        
        let config;
        try {
          config = await safeStorageGet(['apiProvider']);
        } catch (e) {
          this.updateStatus('扩展上下文失效，请刷新页面');
      return;
    }
        const apiProvider = config.apiProvider || 'ollama';
        this.updateStatus(`已恢复原文 (当前: ${getProviderName(apiProvider)})`);
      }
      this.state.paragraphs = [];
    },

    async startGeneration() {
      const panel = document.getElementById('cr-floating-panel');
      const shadow = panel.shadowRoot;
      
      let config;
      try {
        config = await safeStorageGet(['apiProvider', 'ollamaModel', 'googleModel', 'dashscopeModel']);
      } catch (e) {
        this.updateStatus(e.message || '扩展上下文失效，请刷新页面后重试');
        return;
      }
      const apiProvider = config.apiProvider || 'ollama';
      
      this.state.model = getModelFromConfig(config, apiProvider);
      this.updateStatus(`检查连接: ${getProviderName(apiProvider)}...`);
      let check;
      try {
        check = await safeSendMessage({ 
          type: 'CHECK_API_STATUS', 
          model: this.state.model 
        });
      } catch (e) {
        this.updateStatus(e.message || '扩展上下文失效，请刷新页面后重试');
        return;
      }
      
      // 防御性检查：如果 check 为 undefined，说明 Background 没有响应
      if (!check || typeof check !== 'object') {
        this.updateStatus('连接失败: 无法获取服务状态，请检查扩展是否正常运行');
      return;
    }

      if (!check.success) {
        this.updateStatus(`连接失败: ${check.error || '未知错误'}`);
      return;
    }
      if (apiProvider === 'ollama' && !check.modelExists) {
        this.updateStatus(`模型 ${this.state.model} 未下载或不可用。请点击设置图标检查配置。`);
      return;
    }

      this.updateStatus('正在解析网页...');
      this.state.paragraphs = await this.parseDocument();
      
      if (this.state.paragraphs.length === 0) {
        this.updateStatus('未找到适合生成的正文段落');
      return;
    }

      this.state.stats = { total: this.state.paragraphs.length, done: 0, success: 0 };
      shadow.getElementById('btn-generate').style.display = 'none';
      
      this.processQueue();
    },

    async processQueue() {
      const shadow = document.getElementById('cr-floating-panel').shadowRoot;
      let config;
      try {
        config = await safeStorageGet(['apiProvider']);
      } catch (e) {
        this.updateStatus(e.message || '扩展上下文失效，请刷新页面后重试');
        return;
      }
      const apiProvider = config.apiProvider || 'ollama';
      const providerName = getProviderName(apiProvider);
      for (let i = 0; i < this.state.paragraphs.length; i++) {
        const p = this.state.paragraphs[i];
        p.status = 'processing';
        
        this.updateStatus(`生成中 (${providerName}) ${i+1}/${this.state.paragraphs.length}...`, {
          current: i,
          total: this.state.paragraphs.length
        });

        try {
          const response = await safeSendMessage({
            type: 'GENERATE_CLOZE',
            paragraph: { id: p.id, text: p.text },
            model: this.state.model
          });

          if (response.success && response.data.clozes && response.data.clozes.length > 0) {
            this.applyClozeToParagraph(p, response.data.clozes);
            this.state.stats.success++;
          }
        } catch (err) {
          // 静默处理错误，继续处理下一个段落
        }
        
        this.state.stats.done++;
        p.status = 'done';
      }
      
      this.updateStatus(`生成完成! 成功 ${this.state.stats.success}/${this.state.stats.total}`, {
        current: this.state.stats.total,
        total: this.state.stats.total
      });
      
      shadow.getElementById('btn-submit').style.display = 'inline-block';
      shadow.getElementById('btn-submit').disabled = false;
    },

    applyClozeToParagraph(paragraphObj, clozes) {
      const el = paragraphObj.element;
      
      // 去重：如果多个挖空有相同的 target，只保留第一个
      const seenTargets = new Set();
      const uniqueClozes = clozes.filter(cloze => {
        if (seenTargets.has(cloze.target)) return false;
        seenTargets.add(cloze.target);
        return true;
      });
      
      // 按长度从长到短排序，避免短词包含在长词中导致替换错误
      uniqueClozes.sort((a, b) => b.target.length - a.target.length);

      uniqueClozes.forEach((cloze, index) => {
        const optionsHtml = cloze.options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
        
        const selectId = `${paragraphObj.id}-sel-${index}`;
        const safeAnalysis = (cloze.analysis || '').replace(/"/g, '&quot;');
        const safeAnswer = (cloze.answer || '').replace(/"/g, '&quot;');
        
        const selectHtml = `
          <span class="cr-cloze-wrapper">
            <select class="cr-select" id="${selectId}" data-answer="${safeAnswer}" data-analysis="${safeAnalysis}">
              <option value="" disabled selected>___</option>
              ${optionsHtml}
            </select>
          </span>
        `;

        this.replaceTextInNode(el, cloze.target, selectHtml);
      });
      
      el.classList.add('cr-paragraph-processed');
    },

    replaceTextInNode(rootNode, targetText, replacementHtml) {
      const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
      let targetNode = null;
      
      while(walker.nextNode()) {
        const currentNode = walker.currentNode;
        
        // 跳过已经在 select 元素内的文本节点（避免重复替换）
        if (currentNode.parentElement && currentNode.parentElement.closest('select.cr-select')) {
          continue;
        }
        
        // 跳过已经在 cr-cloze-wrapper 内的文本节点
        if (currentNode.parentElement && currentNode.parentElement.closest('.cr-cloze-wrapper')) {
          continue;
        }
        
        if (currentNode.nodeValue.includes(targetText)) {
          targetNode = currentNode;
          break; 
        }
      }

      if (targetNode) {
        const parts = targetNode.nodeValue.split(targetText);
        const fragment = document.createDocumentFragment();
        
        const firstPart = parts.shift();
        if (firstPart) {
          fragment.appendChild(document.createTextNode(firstPart));
        }
        
        const temp = document.createElement('span');
        temp.innerHTML = replacementHtml;
        while (temp.firstChild) {
          fragment.appendChild(temp.firstChild);
        }
        
        if (parts.length > 0) {
          fragment.appendChild(document.createTextNode(parts.join(targetText)));
        }
        
        targetNode.parentNode.replaceChild(fragment, targetNode);
      }
    },

    async loadSettingsToPanel(shadow) {
      let settings;
      try {
        settings = await safeStorageGet(['apiProvider', 'ollamaBaseUrl', 'ollamaModel', 'googleApiKey', 'googleModel', 'dashscopeApiKey', 'dashscopeModel']);
      } catch (e) {
        this.updateStatus(e.message || '扩展上下文失效，请刷新页面');
      return;
    }
      
      const apiProvider = settings.apiProvider || 'ollama';
      shadow.getElementById('cr-api-provider').value = apiProvider;
      
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
    },

    async saveSettingsFromPanel(shadow) {
      const apiProvider = shadow.getElementById('cr-api-provider').value;
      const settings = { apiProvider };
      
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
        this.updateStatus('未知的 API 提供者');
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
        this.updateStatus('设置已保存！');
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
    window.ClozeReadingApp.init();
  } else {
    // 面板已存在，显示它并恢复状态
    existingPanel.style.display = 'block';
    const shadow = existingPanel.shadowRoot;
    if (shadow) {
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
        window.ClozeReadingApp.updateStatus('可以继续做题或提交答案');
      } else {
        // 没有题目，显示生成按钮
        const btnGenerate = shadow.getElementById('btn-generate');
        const btnSubmit = shadow.getElementById('btn-submit');
        const btnReset = shadow.getElementById('btn-reset');
        if (btnGenerate) btnGenerate.style.display = 'inline-block';
        if (btnSubmit) btnSubmit.style.display = 'none';
        if (btnReset) btnReset.style.display = 'none';
        window.ClozeReadingApp.updateStatus('准备就绪');
      }
    }
  }
}
