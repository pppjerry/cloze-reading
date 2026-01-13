// src/background.js
// Cloze-Reading v2.0 Background Service

const DEFAULT_SETTINGS = {
  provider: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:7b",
  dashscopeApiKey: "",
  dashscopeModel: "qwen-plus",
  googleApiKey: "",
  googleModel: "gemini-2.5-flash",
};

// 日志工具：检查是否是开发版本
// 如果版本号包含 -dev, -test, -beta 等后缀，则认为是开发版本，会打印日志
// 正式版本（如 1.0.0）不会打印日志
function isDevVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    const version = manifest.version || '';
    // 检查版本号是否包含开发标识
    return /-(dev|test|beta|alpha|debug)/i.test(version);
  } catch (e) {
    // 如果无法获取 manifest，默认认为是开发版本（安全起见）
    return true;
  }
}

const DEBUG = isDevVersion();

// 日志函数：只在开发版本中打印
function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

function debugWarn(...args) {
  if (DEBUG) {
    console.warn(...args);
  }
}

function debugError(...args) {
  // 错误日志始终打印，即使在生产版本
  console.error(...args);
}

// 1. 监听插件图标点击，注入 content.js
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url) return;
  
  // 检查是否为特殊页面（不允许脚本注入）
  try {
    const url = new URL(tab.url);
    const protocol = url.protocol;
    
    // 跳过 chrome://, edge://, about:, moz-extension:// 等特殊协议
    if (protocol === 'chrome:' || protocol === 'edge:' || protocol === 'about:' || protocol === 'moz-extension:') {
      debugWarn('Cannot inject script into special page:', tab.url);
      return;
    }
    } catch (e) {
    // URL 解析失败，可能是特殊页面，跳过
    debugWarn('Cannot parse URL, skipping injection:', tab.url);
    return;
  }
  
  // 先注入 Readability.js，再注入 content.js
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['src/vendor/readability/Readability.js']
  }).then(() => {
    // Readability.js 注入成功，再注入 content.js
    return chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content.js']
    });
  }).catch(err => {
    // 静默处理特殊页面的注入错误
    if (err.message && err.message.includes('extensions gallery')) {
      // 扩展程序管理页面，静默忽略
      return;
    }
    // 其他错误正常记录
    debugError('Script injection failed:', err);
  });
});


// 2. 监听来自 content.js 的请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CHECK_API_STATUS') {
    checkStatus()
      .then(sendResponse)
      .catch(err => {
        debugError('checkStatus failed:', err);
        sendResponse({ success: false, error: err.message || '未知错误' });
      });
    return true; // 保持通道开启以进行异步响应
  }

  if (request.type === 'GENERATE_CLOZE') {
    handleGenerateCloze(request, sender.tab?.id, sendResponse);
    return true; 
  }
});

// 3. 状态检查
async function checkStatus() {
  const stored = await chrome.storage.sync.get(['apiProvider', 'provider', 'ollamaBaseUrl', 'ollamaModel', 'dashscopeApiKey', 'googleApiKey']);
  const provider = stored.apiProvider || stored.provider || 'ollama';

  if (provider === 'dashscope') {
    if (!stored.dashscopeApiKey) {
      return { success: false, error: "未配置 DashScope API Key" };
    }
    return { success: true, modelExists: true, provider: 'dashscope' };
  } 
  
  else if (provider === 'google') {
    if (!stored.googleApiKey) {
      return { success: false, error: "未配置 Google AI Studio API Key" };
    }
    return { success: true, modelExists: true, provider: 'google' };
}

  else {
    // Ollama
    const baseUrl = stored.ollamaBaseUrl || DEFAULT_SETTINGS.ollamaBaseUrl;
    const targetModel = stored.ollamaModel || DEFAULT_SETTINGS.ollamaModel;
    
    try {
      const tagsRes = await fetch(`${baseUrl}/api/tags`);
      if (!tagsRes.ok) throw new Error('Ollama 服务未连接');
      
      const data = await tagsRes.json();
      const availableModels = data.models ? data.models.map(m => m.name) : [];
      
      let modelExists = false;
      if (targetModel) {
          modelExists = availableModels.some(m => m.startsWith(targetModel));
      }
      
      return { success: true, modelExists, availableModels, targetModel, provider: 'ollama' }; 
    } catch (error) {
      return { success: false, error: error.message };
}
  }
}

// 计算词数的辅助函数（支持中英文）
function countWords(text) {
  const cleaned = text.replace(/[，。！？、；：""''（）【】《》\s]+/g, ' ');
  const chineseChars = (cleaned.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = cleaned.trim().split(/\s+/).filter(w => w.length > 0 && !/[\u4e00-\u9fa5]/.test(w)).length;
  return Math.ceil(chineseChars / 2) + englishWords;
}

// 4. 处理生成请求
// 辅助函数：发送日志到 content script（只在开发版本）
function logToConsole(tabId, level, ...args) {
  if (!DEBUG || !tabId) return; // 生产版本不发送日志
  chrome.tabs.sendMessage(tabId, {
    type: 'LOG',
    level: level, // 'log', 'warn', 'error'
    args: args
  }).catch(() => {}); // 忽略错误（可能页面已关闭）
}

async function handleGenerateCloze({ paragraph }, tabId, sendResponse) {
  const stored = await chrome.storage.sync.get(['apiProvider', 'provider', 'ollamaBaseUrl', 'ollamaModel', 'dashscopeApiKey', 'dashscopeModel', 'googleApiKey', 'googleModel']);
  const provider = stored.apiProvider || stored.provider || 'ollama';
  
  const { id, text } = paragraph;
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(text);
  const wordCount = countWords(text);

  logToConsole(tabId, 'log', `[生成] 段落 ${id}，词数: ${wordCount}，Provider: ${provider}`);
  logToConsole(tabId, 'log', `[LLM 输入] 段落 ${id}:`, text);
  logToConsole(tabId, 'log', `[System Prompt] 段落 ${id}:`, systemPrompt);
  logToConsole(tabId, 'log', `[User Prompt] 段落 ${id}:`, userPrompt);

  try {
    let rawContent = "";
    
    logToConsole(tabId, 'log', `[API 调用] 段落 ${id}，开始调用 ${provider}...`);
    
    if (provider === 'dashscope') {
      rawContent = await callDashScope(stored, systemPrompt, userPrompt);
    } else if (provider === 'google') {
      rawContent = await callGoogle(stored, systemPrompt, userPrompt);
    } else {
      rawContent = await callOllama(stored, systemPrompt, userPrompt);
    }
    
    logToConsole(tabId, 'log', `[LLM 输出] 段落 ${id}:`, rawContent);
    
    const result = parseLLMResponse(rawContent);
    
    logToConsole(tabId, 'log', `[解析结果] 段落 ${id}，原始挖空数: ${result.clozes.length}`);
    
    // 如果段落词数 <= 100，限制为只挖 1 个空
    if (wordCount <= 100 && result.clozes.length > 1) {
      result.clozes = result.clozes.slice(0, 1);
      logToConsole(tabId, 'log', `[限制] 段落 ${id}，词数 <= 100，限制为 1 个挖空`);
    }
    
    logToConsole(tabId, 'log', `[最终结果] 段落 ${id}，挖空数: ${result.clozes.length}`, result.clozes);
    
    sendResponse({ success: true, id, data: result });

  } catch (error) {
    debugError('Generation failed:', error);
    logToConsole(tabId, 'error', `[错误] 段落 ${id}:`, error.message);
    sendResponse({ success: false, id, error: error.message });
  }
}

// 调用 Ollama
async function callOllama(settings, systemPrompt, userPrompt) {
  const baseUrl = settings.ollamaBaseUrl || DEFAULT_SETTINGS.ollamaBaseUrl;
  const model = settings.ollamaModel || DEFAULT_SETTINGS.ollamaModel;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      messages: messages,
      stream: false,
      options: { temperature: 0.2, num_ctx: 4096 }
    })
  });

  if (!response.ok) {
    if (response.status === 403) throw new Error('Ollama 403 Forbidden. 请配置 OLLAMA_ORIGINS="*"');
    throw new Error(`Ollama Error: ${response.status}`);
  }

  const data = await response.json();
  return data.message.content;
  }

// 调用 DashScope
async function callDashScope(settings, systemPrompt, userPrompt) {
  const apiKey = settings.dashscopeApiKey;
  const model = settings.dashscopeModel || DEFAULT_SETTINGS.dashscopeModel;
  const url = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`DashScope Error: ${response.status} - ${errBody}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// 调用 Google AI Studio (Gemini)
async function callGoogle(settings, systemPrompt, userPrompt) {
  const apiKey = settings.googleApiKey;
  const model = settings.googleModel || DEFAULT_SETTINGS.googleModel;
  
  // Gemini API URL format: https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=YOUR_API_KEY
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Gemini 使用 systemInstruction 作为系统提示词
  const requestBody = {
    contents: [{ 
      parts: [{ text: userPrompt }] 
    }],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      temperature: 0.2
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Google AI Error: ${response.status} - ${errBody}`);
    }

  const data = await response.json();
  // Gemini response structure
  return data.candidates[0].content.parts[0].text;
}

// 5. Prompt 构建 - 分离系统提示词和用户输入
function buildSystemPrompt() {
  const parts = [
    '你是一个专业的阅读理解出题老师。请针对用户提供的文本制作"完形填空"。',
    '',
    '**要求**:',
    '1. **用户需要理解上下文才可以得出答案**：',
    '2. **关注名词、命名实体、概念性词汇、专业术语/技术词汇**：',
    '   - 优先选择：',
    '     * 专有名词（人名、地名、机构名）',
    '     * 专业术语/技术词汇（领域特定概念，如 API、协议、算法、架构、框架、模型等）',
    '     * 核心概念、重要名词',
    '   - 不要选择：动词、形容词、副词、连词、虚词。',
    '3. **每个段落最多挖 2 个空（严格限制）**：',
    '   - 如果少于20字或没有合适的目标词，返回空列表 []。',
    '   - 每100字以内，只允许1个空，绝对不能挖2个空！',
    '   - 挖空词必须是原文中存在的词（精确匹配，不要带标点）。',
    '4. 为每个挖空点提供：',
    '   - target: 原文中被挖掉的词（必须精确匹配原文，不要带标点）。',
    '   - options: 4个选项（包含正确答案）。所有选项都必须是实际有意义的词。干扰项要有迷惑性（词性一致，语义相关但不正确）。',
    '   - answer: 正确选项（必须是 options 中的一个）。',
    '   - analysis: 简短解析（中文，20字以内）。',
    '',
    '**输出格式**:',
    '必须且仅返回纯 JSON 格式，不要包含 Markdown 代码块标记。',
    '**选项顺序要求：正确答案在 options 数组中的位置必须是随机的（可以是第1、2、3或4个位置），不要总是放在固定位置。**',
    '格式如下：',
    '{',
    '  "clozes": [',
    '    {',
    '      "target": "挖空词",',
    '      "options": ["正确词", "干扰1", "干扰2", "干扰3"],',
    '      "answer": "正确词",',
    '      "analysis": "解析..."',
    '    }',
    '    // 注意：正确答案的位置要随机，可以是 options 数组的任意位置',
    '  ]',
    '}'
  ];
  return parts.join('\n');
}

function buildUserPrompt(text) {
  return text;
}

// 6. 鲁棒的 JSON 解析器
function parseLLMResponse(content) {
  let jsonStr = content.trim();
  let result = null;
  
  try { 
    result = JSON.parse(jsonStr);
  } catch (e) {
    jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
    try { 
      result = JSON.parse(jsonStr);
    } catch (e2) {
      const match = content.match(/\{\s*"clozes"\s*:\s*\[[\s\S]*?\]\s*\}/);
      if (match) {
        try { 
          result = JSON.parse(match[0]);
        } catch (e3) {
          return { clozes: [] };
    }
      } else {
        return { clozes: [] };
      }
    }
  }

  // 后处理：清理和验证
  if (result && result.clozes && Array.isArray(result.clozes)) {
    // 1. 确保最多只保留 2 个挖空
    if (result.clozes.length > 2) {
      result.clozes = result.clozes.slice(0, 2);
      }

    // 2. 过滤掉包含占位符的选项和 target
    result.clozes = result.clozes.filter(cloze => {
      const targetStr = String(cloze.target || '').trim();
      if (targetStr === '' || targetStr.includes('___') || targetStr === '空白' || targetStr === '空') {
        return false;
      }

      if (!cloze.options || !Array.isArray(cloze.options)) {
        return false;
      }

      const validOptions = cloze.options.filter(opt => {
        if (!opt || typeof opt !== 'string') return false;
        const cleanOpt = opt.trim();
        return cleanOpt !== '' && !cleanOpt.includes('___') && cleanOpt !== '空白' && cleanOpt !== '空';
      });

      if (validOptions.length < 4 || !cloze.answer || !validOptions.includes(cloze.answer)) {
        return false;
      }

      cloze.options = validOptions.slice(0, 4);
      return true;
      });
  }

  return result || { clozes: [] };
}
