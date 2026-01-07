# cloze-reading（浏览器插件）

把网页正文变成"完形填空"，基于 LLM 生成题目，帮助你在阅读时主动回忆和理解关键概念。

## 功能特性

### 核心功能
- **智能正文抽取**：自动识别并处理文章主内容区域，跳过导航、侧边栏等非内容区域
- **AI 生成题目**：支持多种 LLM 模型生成完形填空题
- **精准挖空**：只挖空名词、命名实体、概念性词汇、专业术语，不挖动词、形容词等
- **智能过滤**：自动跳过少于 20 个词的短段落，确保题目质量
- **交互式答题**：在页面中直接选择答案，完成后统一公布正确答案和解析

### 挖空策略
- 优先选择：专有名词（人名、地名、机构名）、专业术语、核心概念
- 每个段落最多挖 2 个空
- 短段落（少于 20 个词）自动跳过
- 中等段落（100 个词以内）只挖 1 个空

## 安装使用

### 安装步骤
1. 浏览器打开扩展管理页（Chrome: `chrome://extensions/`，Edge: `edge://extensions/`）
2. 开启"开发者模式"
3. 选择"加载已解压的扩展程序"，选中本目录
4. 打开任意文章页，点击扩展图标即可使用

### 使用流程
1. 在文章页面点击扩展图标，打开浮动面板
2. 点击"开始生成"按钮
3. 等待 AI 生成题目（进度条显示处理进度）
4. 在页面中选择答案（下拉框选择）
5. 点击"提交答案"查看结果
6. 点击"恢复原文"可恢复原始内容

## 配置设置

### 打开设置
在浮动面板中点击设置图标（⚙️），展开设置面板。

### 支持的 API 提供者

#### 1. Ollama（本地）
- **适用场景**：本地部署，数据隐私，免费使用
- **配置项**：
  - **Ollama Base URL**：默认 `http://localhost:11434`
  - **模型名称**：格式 `模型名:版本`，例如 `qwen2.5:7b`、`llama3:8b`
- **使用前准备**：
  - 确保本机已安装并启动 Ollama
  - 如需跨域访问，设置环境变量：`export OLLAMA_ORIGINS="*"`（macOS/Linux）或 `$env:OLLAMA_ORIGINS="*"`（Windows）

#### 2. Google AI Studio
- **适用场景**：云端服务，响应快速
- **配置项**：
  - **API Key**：从 [Google AI Studio](https://aistudio.google.com/apikey) 获取
  - **模型名称**：格式 `gemini-版本-类型`，例如 `gemini-2.5-flash`、`gemini-1.5-pro`
- **推荐模型**：`gemini-2.5-flash`（速度快）、`gemini-1.5-pro`（能力强）

#### 3. 阿里云通义千问（DashScope）
- **适用场景**：国内用户，访问稳定
- **配置项**：
  - **API Key**：从 [阿里云 DashScope](https://dashscope.console.aliyun.com/) 获取
  - **模型名称**：格式 `qwen-类型`，例如 `qwen-turbo`、`qwen-plus`、`qwen-max`、`qwen-long`
- **推荐模型**：
  - `qwen-turbo`：性价比高，适合快速生成
  - `qwen-plus`：能力更强，推荐使用
  - `qwen-max`：最强能力
  - `qwen-long`：超长文本支持

## 技术实现

### 正文提取
- 优先识别文章主内容区域（`article`、`main`、`.content` 等）
- 智能过滤导航、侧边栏、代码块等非内容区域
- 自动跳过少于 15 个词的短段落

### AI 提示词
- 严格要求只挖空名词、命名实体、专业术语
- 每个段落最多 2 个空，根据段落长度自动调整
- 生成 4 个选项，正确答案位置随机

### 交互设计
- 浮动面板设计，不遮挡主要内容
- 实时进度显示
- 答案提交后显示正确/错误状态和解析

## 常见问题

### 遇到 403 错误（Ollama）
这是 Ollama 的跨域（CORS）问题，解决方法：
- **macOS/Linux**：运行 `export OLLAMA_ORIGINS="*"` 然后重启 Ollama
- **Windows**：在 PowerShell 运行 `$env:OLLAMA_ORIGINS="*"` 然后重启 Ollama
- 或创建配置文件 `~/.ollama/ollama.env`，内容为 `OLLAMA_ORIGINS=*`

### 无法获取模型列表（Ollama）
- 检查 Ollama 是否已启动（运行 `ollama serve`）
- 检查 Base URL 是否正确（默认 `http://localhost:11434`）
- 检查是否已配置跨域（见上方 403 错误解决方案）
- 可以手动输入模型名

### 生成失败或题目为空
- 检查 API Key 是否正确（Google AI Studio / DashScope）
- 检查网络连接
- 确保段落长度足够（至少 15 个词）
- 某些页面结构特殊，可能无法正确提取内容

## 第三方代码

- **Mozilla Readability**：`src/vendor/readability/Readability.js`
  - License：Apache-2.0
  - 文件位置：`src/vendor/readability/LICENSE.md`

## 开发说明

### 项目结构
```
cloze-reading/
├── manifest.json          # 扩展配置
├── src/
│   ├── background.js      # 后台服务，处理 API 调用
│   ├── content.js         # 内容脚本，处理页面交互
│   ├── ui.css             # 样式文件
│   └── vendor/            # 第三方库
└── README.md
```

### 权限说明
- `activeTab`：访问当前标签页
- `scripting`：注入内容脚本
- `storage`：保存用户设置
- `host_permissions`：访问 API 服务

## 版本信息

- **当前版本**：0.1.0
- **Manifest 版本**：3
