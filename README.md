[中文](README.md)｜[English](README.en.md)

# cloze-reading（浏览器插件）


基于LLM把网页正文变成“完型填空”，给阅读增加点摩擦，让你阅读更深刻



## 功能特性

### 核心功能
- **智能正文抽取**：基于 Mozilla Readability，只处理正文区域，自动跳过导航栏、侧边栏、脚注等噪声。
- **AI 生成完形填空**：支持多个 LLM 提供者（Ollama、本地；Google AI Studio；阿里云 DashScope）。
- **交互式答题**：题目直接渲染在原文中，用下拉框选择答案，提交后展示正确答案和解析。



## 安装使用

### 安装步骤
1. 打开浏览器扩展管理页（Chrome: `chrome://extensions/`，Edge: `edge://extensions/`）
2. 开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本目录 `cloze-reading`
4. 打开任意文章页面，点击扩展图标即可使用

### 使用流程
1. 在文章页面点击扩展图标，打开右上角浮动面板
2. 选择 **API Provider / 模型提供者**，填写对应的 API Key / 模型名
3. 使用右上角的 **UI Language**（中文 / EN）切换界面语言
4. 点击 **开始生成 / Start** 按钮，等待进度条完成
5. 在正文中直接选择答案，点击 **提交答案 / Submit** 查看结果和解析
6. 点击 **恢复原文 / Restore** 可以还原整篇文章



## 配置设置

### 打开设置
在浮动面板右上角点击齿轮图标（⚙️）展开设置。

### 界面语言
- 支持 **简体中文** 与 **English** 两种界面语言。
- 语言设置会保存在浏览器中，下次打开自动生效。

### 支持的 API 提供者

#### 1. Ollama（本地）
- **适用场景**：本地部署，数据不出本机，可离线或低成本使用。
- **配置项**：
  - **Ollama Base URL**：默认 `http://localhost:11434`
  - **模型名称**：`模型名:版本`，如 `qwen2.5:7b`、`llama3:8b`
- **使用前准备**：
  - 安装并启动 Ollama
  - 如需跨域访问：  
    macOS/Linux: `export OLLAMA_ORIGINS="*"`  
    Windows: `$env:OLLAMA_ORIGINS="*"`

#### 2. Google AI Studio
- **适用场景**：访问 Google 服务稳定、需要高质量英文模型时。
- **配置项**：
  - **API Key**：从 [Google AI Studio](https://aistudio.google.com/apikey) 获取
  - **模型名称**：`gemini-版本-类型`，如 `gemini-2.5-flash`、`gemini-1.5-pro`
- **推荐模型**：
  - `gemini-2.5-flash`：速度快，适合交互式使用
  - `gemini-1.5-pro`：能力更强，适合复杂文本

#### 3. 阿里云通义千问（DashScope）
- **适用场景**：国内网络环境、需要稳定访问时。
- **配置项**：
  - **API Key**：从 [阿里云 DashScope](https://dashscope.console.aliyun.com/) 获取
  - **模型名称**：`qwen-类型`，如 `qwen-turbo`、`qwen-plus`、`qwen-max`、`qwen-long`
- **推荐模型**：
  - `qwen-turbo`：性价比最高，适合日常使用
  - `qwen-plus`：更强能力，推荐默认使用
  - `qwen-max`：最强模型
  - `qwen-long`：超长上下文



## 常见问题

### 遇到 403 错误（Ollama）
这是 Ollama 的跨域（CORS）问题，解决方法：
- macOS/Linux：运行 `export OLLAMA_ORIGINS="*"` 然后重启 Ollama
- Windows：在 PowerShell 中运行 `$env:OLLAMA_ORIGINS="*"` 并重启 Ollama
- 或创建配置文件 `~/.ollama/ollama.env`，写入 `OLLAMA_ORIGINS=*`

### 生成失败或题目为空
- 检查 API Key 是否正确（Google AI Studio / DashScope）
- 检查网络连接
- 确保段落长度足够（至少约 15 个 token）
- 某些页面结构特殊，可能无法正确提取内容



## 第三方代码

- **Mozilla Readability**：`src/vendor/readability/Readability.js`  
  License: Apache‑2.0  
  文件位置：`src/vendor/readability/LICENSE.md`



## 开发说明

### 项目结构
```text
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
- `host_permissions`：访问外部 API
