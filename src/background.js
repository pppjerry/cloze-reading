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

// 1. 监听插件图标点击，切换面板显示
// 注意：content.js 已通过 manifest.json content_scripts 自动注入
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url) return;
  
  // 检查是否为特殊页面
  try {
    const url = new URL(tab.url);
    const protocol = url.protocol;
    
    if (protocol === 'chrome:' || protocol === 'edge:' || protocol === 'about:' || protocol === 'moz-extension:') {
      debugWarn('Cannot toggle panel on special page:', tab.url);
      return;
    }
  } catch (e) {
    debugWarn('Cannot parse URL:', tab.url);
    return;
  }
  
  // 发送消息给 content.js 切换面板显示
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(err => {
    // 如果 content.js 还没加载，静默忽略
    debugLog('Toggle panel message failed (content script may not be ready):', err.message);
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

  if (request.type === 'GENERATE_CLOZE_BATCH') {
    handleGenerateClozeBatch(request, sender.tab?.id, sendResponse);
    return true;
  }

  if (request.type === 'GENERATE_CLOZE_ANALYSIS_BATCH') {
    handleGenerateClozeAnalysisBatch(request, sender.tab?.id, sendResponse);
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

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text || '');
}

function hasLatin(text) {
  return /[A-Za-z]/.test(text || '');
}

function getLanguageClass(text) {
  const zh = hasChinese(text);
  const en = hasLatin(text);
  if (zh && en) return 'mixed';
  if (zh) return 'zh';
  if (en) return 'en';
  return 'other';
}

function filterClozesByTargetLanguage(clozes) {
  return (clozes || []).filter(cloze => {
    const target = String(cloze.target || '');
    const answer = String(cloze.answer || '');
    const options = Array.isArray(cloze.options) ? cloze.options.map(String) : [];
    const lang = getLanguageClass(target);
    if (lang === 'zh') {
      if (hasLatin(answer)) return false;
      if (options.some(opt => hasLatin(opt))) return false;
    } else if (lang === 'en') {
      if (hasChinese(answer)) return false;
      if (options.some(opt => hasChinese(opt))) return false;
    }
    return true;
  });
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

// 批量处理生成请求（一次性处理多个段落）
async function handleGenerateClozeBatch({ paragraphs }, tabId, sendResponse) {
  const stored = await chrome.storage.sync.get(['apiProvider', 'provider', 'ollamaBaseUrl', 'ollamaModel', 'dashscopeApiKey', 'dashscopeModel', 'googleApiKey', 'googleModel']);
  const provider = stored.apiProvider || stored.provider || 'ollama';

  logToConsole(tabId, 'log', `[批量生成] 开始处理 ${paragraphs.length} 个段落，Provider: ${provider}`);

  const systemPrompt = buildQuestionSystemPrompt();
  const userPrompt = buildBatchQuestionUserPrompt(paragraphs);

  logToConsole(tabId, 'log', `[System Prompt]:`, systemPrompt);
  logToConsole(tabId, 'log', `[User Prompt]:`, userPrompt);

  try {
    let rawContent = "";

    logToConsole(tabId, 'log', `[API 调用] 开始调用 ${provider}...`);

    if (provider === 'dashscope') {
      rawContent = await callDashScope(stored, systemPrompt, userPrompt);
    } else if (provider === 'google') {
      rawContent = await callGoogle(stored, systemPrompt, userPrompt);
    } else {
      rawContent = await callOllama(stored, systemPrompt, userPrompt);
    }

    logToConsole(tabId, 'log', `[LLM 输出]:`, rawContent);

    const batchResult = parseBatchLLMResponse(rawContent);

    logToConsole(tabId, 'log', `[批量解析结果] 成功解析 ${batchResult.items.length} 个段落的题目`);

    // 按段落ID组织结果，处理词数限制
    const resultsById = {};
    for (const item of batchResult.items) {
      const paragraph = paragraphs.find(p => p.id === item.id);
      if (!paragraph) {
        logToConsole(tabId, 'warn', `[警告] 找不到段落 ${item.id}`);
        continue;
      }

      let clozes = item.clozes || [];

      // 如果段落词数 <= 100，限制为只挖 1 个空
      const wordCount = countWords(paragraph.text);
      if (wordCount <= 100 && clozes.length > 1) {
        clozes = clozes.slice(0, 1);
        logToConsole(tabId, 'log', `[限制] 段落 ${item.id}，词数 <= 100，限制为 1 个挖空`);
      }

      // 语言过滤：选项/答案必须与 target 语言一致
      clozes = filterClozesByTargetLanguage(clozes);

      logToConsole(tabId, 'log', `[段落 ${item.id}] 挖空数: ${clozes.length}`);

      resultsById[item.id] = { clozes };
    }

    sendResponse({ success: true, data: resultsById });

  } catch (error) {
    debugError('Batch generation failed:', error);
    logToConsole(tabId, 'error', `[批量错误]:`, error.message);
    sendResponse({ success: false, error: error.message });
  }
}

// 解析生成（批量）
async function handleGenerateClozeAnalysisBatch({ items }, tabId, sendResponse) {
  const stored = await chrome.storage.sync.get(['apiProvider', 'provider', 'ollamaBaseUrl', 'ollamaModel', 'dashscopeApiKey', 'dashscopeModel', 'googleApiKey', 'googleModel']);
  const provider = stored.apiProvider || stored.provider || 'ollama';

  logToConsole(tabId, 'log', `[批量解析] 开始处理 ${items.length} 个段落，Provider: ${provider}`);

  const systemPrompt = buildAnalysisSystemPrompt();
  const userPrompt = buildBatchAnalysisUserPrompt(items);
  logToConsole(tabId, 'log', `[Analysis System Prompt]:`, systemPrompt);
  logToConsole(tabId, 'log', `[Analysis User Prompt]:`, userPrompt);

  try {
    let rawContent = '';
    if (provider === 'dashscope') {
      rawContent = await callDashScope(stored, systemPrompt, userPrompt);
    } else if (provider === 'google') {
      rawContent = await callGoogle(stored, systemPrompt, userPrompt);
    } else {
      rawContent = await callOllama(stored, systemPrompt, userPrompt);
    }

    logToConsole(tabId, 'log', `[Analysis LLM 输出]:`, rawContent);
    const analysisResult = parseBatchAnalysisResponse(rawContent);

    const resultsById = {};
    for (const item of analysisResult.items || []) {
      resultsById[item.id] = { clozes: item.clozes || [] };
    }

    sendResponse({ success: true, data: resultsById });
  } catch (error) {
    debugError('Analysis batch failed:', error);
    logToConsole(tabId, 'error', `[解析错误]:`, error.message);
    sendResponse({ success: false, error: error.message });
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
function buildQuestionSystemPrompt() {
  const parts = [
    '# 角色',
    '你是阅读理解出题专家，为文章制作高质量的完形填空题。',
    '',
    '# 出题原则',
    '1. **可推断性**：挖空的词必须能通过上下文或背景知识推断出来',
    '2. **有价值**：挖空核心概念、专业术语，帮助读者加深理解',
    '3. **有难度**：干扰项要有迷惑性，不能一眼看出答案',
    '',
    '# 字段说明',
    '- target: 被挖空的词（必须精确匹配原文，不带标点）',
    '- options: 4个选项，正确答案位置随机，干扰项词性一致、语义相关',
    '- answer: 正确答案（必须在options中）',
    '',
    '# 数量限制',
    '- 每100字最多1空，每段最多2空',
    '- 少于20字或无合适词则返回空列表[]',
    '',
    '# 语言规则（针对挖空词与选项）',
    '- 选定 target 后，不得将其翻译成其他语言',
    '- options/answer 必须与 target 语言一致（中→中，英→英）',
    '- 允许中文段落出现少量英文术语（如 AI/FOMO）',
    '',
    '# 输出格式',
    '仅返回纯JSON：{"items":[{"id":"id","clozes":[{"target":"词","options":["选项1","选项2","选项3","选项4"],"answer":"选项1"}]}]}'
  ];
  return parts.join('\n');
}

// 批量用户提示词构建
function buildBatchQuestionUserPrompt(paragraphs) {
  const paragraphsJson = JSON.stringify({
    paragraphs: paragraphs.map(p => ({ id: p.id, text: p.text }))
  }, null, 2);

  return `下方是若干段落，每个段落有唯一 id。请按系统说明，为每个段落生成 cloze 题目，并按 id 对应输出 JSON。

${paragraphsJson}`;
}

function buildAnalysisSystemPrompt() {
  const parts = [
    '# 角色',
    '你是阅读理解解析助手，为完形填空题生成推理提示。',
    '',
    '# 解析原则',
    '1. **不泄露答案**：解析中不能出现答案词本身',
    '2. **可推断性**：基于挖空后的文本可见线索 + 常识背景推理',
    '3. **有帮助**：说明“为什么能推断出答案”，而非复述原文',
    '',
    '# 输入说明',
    '- masked_text: 挖空后的文本（答案已被替换为 ____ ）',
    '- clozes: 题目（包含 target/options/answer）',
    '',
    '# 输出要求',
    '- 为每个 cloze 生成 analysis（50字以内）',
    '- analysis 不得包含 target 或 answer',
    '- 禁止使用：\"文中提到\"、\"原文说\"等空话',
    '',
    '# 输出格式',
    '仅返回纯JSON：{"items":[{"id":"id","clozes":[{"target":"词","analysis":"从可见线索推断"}]}]}'
  ];
  return parts.join('\n');
}

function buildBatchAnalysisUserPrompt(items) {
  const payloadItems = items.map(p => {
    const clozes = (p.clozes || []).map(c => ({
      target: c.target,
      options: c.options,
      answer: c.answer
    }));
    const maskedText = maskTextWithClozes(p.text, p.clozes || []);
    return { id: p.id, masked_text: maskedText, clozes };
  });
  return JSON.stringify({ items: payloadItems }, null, 2);
}

function maskTextWithClozes(text, clozes) {
  let masked = text;
  for (const cloze of clozes || []) {
    const target = String(cloze.target || '').trim();
    if (!target) continue;
    const idx = masked.indexOf(target);
    if (idx === -1) continue;
    masked = `${masked.slice(0, idx)}____${masked.slice(idx + target.length)}`;
  }
  return masked;
}

// 6. Fisher-Yates 洗牌算法，随机打乱数组
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// 7. JSON 解析器
function parseBatchLLMResponse(content) {
  let jsonStr = content.trim();
  let result = null;

  try {
    result = JSON.parse(jsonStr);
  } catch (e) {
    jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
    try {
      result = JSON.parse(jsonStr);
    } catch (e2) {
      const match = content.match(/\{\s*"items"\s*:\s*\[[\s\S]*?\]\s*\}/);
      if (match) {
        try {
          result = JSON.parse(match[0]);
        } catch (e3) {
          return { items: [] };
        }
      } else {
        return { items: [] };
      }
    }
  }

  // 后处理：清理和验证
  if (result && result.items && Array.isArray(result.items)) {
    result.items = result.items.map(item => {
      if (!item.id || !item.clozes) {
        return { id: item.id || 'unknown', clozes: [] };
      }

      // 确保最多只保留 2 个挖空
      if (item.clozes.length > 2) {
        item.clozes = item.clozes.slice(0, 2);
      }

      // 过滤掉包含占位符的选项和 target
      item.clozes = item.clozes.filter(cloze => {
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

        // 随机打乱选项顺序，避免答案总是在固定位置
        cloze.options = shuffleArray(validOptions.slice(0, 4));
        return true;
      });

      return item;
    });
  }

  return result || { items: [] };
}

function parseBatchAnalysisResponse(content) {
  let jsonStr = content.trim();
  let result = null;

  try {
    result = JSON.parse(jsonStr);
  } catch (e) {
    jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
    try {
      result = JSON.parse(jsonStr);
    } catch (e2) {
      const match = content.match(/\{\s*"items"\s*:\s*\[[\s\S]*?\]\s*\}/);
      if (match) {
        try {
          result = JSON.parse(match[0]);
        } catch (e3) {
          return { items: [] };
        }
      } else {
        return { items: [] };
      }
    }
  }

  if (!result || !Array.isArray(result.items)) return { items: [] };
  result.items = result.items.map(item => {
    const clozes = Array.isArray(item.clozes) ? item.clozes : [];
    const normalized = clozes
      .filter(c => c && c.target && c.analysis)
      .map(c => ({ target: String(c.target).trim(), analysis: String(c.analysis).trim() }));
    return { id: item.id, clozes: normalized };
  });
  return result;
}

