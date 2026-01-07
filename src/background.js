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

// 1. 监听插件图标点击，注入 content.js
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url) return;
  
  // 检查是否为特殊页面（不允许脚本注入）
  try {
    const url = new URL(tab.url);
    const protocol = url.protocol;
    
    // 跳过 chrome://, edge://, about:, moz-extension:// 等特殊协议
    if (protocol === 'chrome:' || protocol === 'edge:' || protocol === 'about:' || protocol === 'moz-extension:') {
      console.warn('Cannot inject script into special page:', tab.url);
      return;
    }
    } catch (e) {
    // URL 解析失败，可能是特殊页面，跳过
    console.warn('Cannot parse URL, skipping injection:', tab.url);
    return;
  }
  
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['src/content.js']
  }).catch(err => {
    // 静默处理特殊页面的注入错误
    if (err.message && err.message.includes('extensions gallery')) {
      // 扩展程序管理页面，静默忽略
      return;
    }
    // 其他错误正常记录
    console.error('Script injection failed:', err);
  });
});


// 2. 监听来自 content.js 的请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CHECK_API_STATUS') {
    checkStatus()
      .then(sendResponse)
      .catch(err => {
        console.error('checkStatus failed:', err);
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
// 辅助函数：发送日志到 content script
function logToConsole(tabId, level, ...args) {
  if (!tabId) return;
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
  const prompt = buildPrompt(text);
  const wordCount = countWords(text);

  logToConsole(tabId, 'log', `[生成] 段落 ${id}，词数: ${wordCount}，Provider: ${provider}`);
  logToConsole(tabId, 'log', `[LLM 输入] 段落 ${id}:`, text);
  logToConsole(tabId, 'log', `[Prompt] 段落 ${id}:`, prompt);

  try {
    let rawContent = "";
    
    logToConsole(tabId, 'log', `[API 调用] 段落 ${id}，开始调用 ${provider}...`);
    
    if (provider === 'dashscope') {
      rawContent = await callDashScope(stored, prompt);
    } else if (provider === 'google') {
      rawContent = await callGoogle(stored, prompt);
    } else {
      rawContent = await callOllama(stored, prompt);
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
    console.error('Generation failed:', error);
    logToConsole(tabId, 'error', `[错误] 段落 ${id}:`, error.message);
    sendResponse({ success: false, id, error: error.message });
  }
}

// 调用 Ollama
async function callOllama(settings, prompt) {
  const baseUrl = settings.ollamaBaseUrl || DEFAULT_SETTINGS.ollamaBaseUrl;
  const model = settings.ollamaModel || DEFAULT_SETTINGS.ollamaModel;

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
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
async function callDashScope(settings, prompt) {
  const apiKey = settings.dashscopeApiKey;
  const model = settings.dashscopeModel || DEFAULT_SETTINGS.dashscopeModel;
  const url = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
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
async function callGoogle(settings, prompt) {
  const apiKey = settings.googleApiKey;
  const model = settings.googleModel || DEFAULT_SETTINGS.googleModel;
  
  // Gemini API URL format: https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=YOUR_API_KEY
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2
      }
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Google AI Error: ${response.status} - ${errBody}`);
    }

  const data = await response.json();
  // Gemini response structure
  return data.candidates[0].content.parts[0].text;
}

// 5. Prompt 构建
function buildPrompt(text) {
  const parts = [
    '你是一个专业的阅读理解出题助手。请针对下文制作"完形填空"（Cloze Test）。',
    '',
    '**输入文本**:',
    '"' + text + '"',
    '',
    '**要求**:',
    '1. **只挖名词、命名实体、概念性词汇、专业术语/技术词汇**：',
    '   - 优先选择：',
    '     * 专有名词（人名、地名、机构名）',
    '     * 专业术语/技术词汇（领域特定概念，如 API、协议、算法、架构、框架、模型等）',
    '     * 核心概念、重要名词',
    '   - 不要挖：动词、形容词、副词、连词、虚词。',
    '2. **每个段落最多挖 2 个空（严格限制）**：',
    '   - 如果段落太短（少于20个词）或没有合适的名词/概念，返回空列表 []。',
    '   - **重要：如果段落在100个词以内（包括100个词），必须只挖1个空，绝对不能挖2个空！**',
    '   - 只有超过100个词的段落才能挖2个空。',
    '   - 挖空词必须是原文中存在的词（精确匹配，不要带标点）。',
    '3. 为每个挖空点提供：',
    '   - target: 原文中被挖掉的词（必须精确匹配原文，不要带标点）。不要使用占位符如 ___、___、空白等。',
    '   - options: 4个选项（包含正确答案）。所有选项都必须是实际有意义的词，不要使用占位符如 ___、___、空白等。干扰项要有迷惑性（词性一致，语义相关但不正确）。',
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
