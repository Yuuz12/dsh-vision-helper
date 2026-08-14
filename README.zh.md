# dsh-vision-helper

[English](README.md) | 中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 打造的部署级视觉插件。

注册 `vision_analyze` 工具，让智能体通过**任意可配置的多模态模型**分析图片（OCR、UI/报错截图、图表理解、通用图片描述），并在 Web 应用中提供设置页界面。

**零依赖设计** —— 宿主模块没有任何 import，安装只需复制文件夹 + 一行补丁配置。无需 npm install、无需修改 node_modules 结构、无需软链接。

## 功能特性

- **`vision_analyze` 工具** —— 接受本地图片路径或 `data:` URI，发送给配置的多模态模型，返回分析文字。
- **可配置模型** —— 在「设置 → 视觉助手」中选择提供方与模型（或直接编辑插件目录下的 `dsh-vision-helper.json`）；留空自动选择多模态模型。
- **健壮性** —— 自动剥离粘贴路径中的不可见 Unicode 字符（U+202A 等）；按最长边限制图片尺寸（`maxEdge`，默认 4096px）；去重流式文本；友好的错误提示。
- **自动调用引导** —— 注入系统提示段，让智能体在涉及图片的任务中自动调用 `vision_analyze`。
- **持久且全局** —— 宿主组合插件：重启不丢失，所有会话可用。

## 环境要求（使用者侧）

- DSH Web 部署（设置页仅 Web 端；工具本身在挂载了该插件的任何 profile 中均可用）。
- 在部署的 `llm-pi-ai` 设置（「模型」设置页）中配置好**多模态模型路由**——例如 `mimo-v2.5`，或你添加的任意 OpenAI 兼容视觉端点。插件不携带任何 API Key。

## 安装

1. 将本 `dsh-vision-helper` 文件夹复制到 `<profile>/node_modules/`（默认 profile：`$HOME/.dsh/profiles/web`），使包落在 `<profile>/node_modules/dsh-vision-helper/`。
2. 在 `<profile>/cordis.patch.yml` 中添加插件行：

```yaml
- insert:
    - id: dsh-vision-helper
      name: 'dsh-vision-helper'
```

3. 重启 `dsh web`。完成——无需解析任何依赖，模块完全自包含。

## 配置

通过设置页（**设置 → 视觉助手**）：提供方、模型、温度、最大输出 tokens、最大图片边长。等效的配置文件位于 `<profile>/node_modules/dsh-vision-helper/dsh-vision-helper.json` —— 即插件文件夹内部，卸载插件时随文件夹一并删除，无残留：

```json
{
  "provider": "opencode-go",
  "model": "mimo-v2.5",
  "temperature": 0.2,
  "maxTokens": 1024,
  "maxEdge": 4096,
  "mode": "auto"
}
```

`provider`/`model` 留空 = 自动选择；`maxEdge` 限制图片最长边像素。`mode` 控制注入智能体系统提示的自动调用引导：

- `auto`（默认）—— **智能引导**：若主模型是多模态（图片随对话送达，或可通过 `read_image` 直接查看本地图片），直接查看分析、零额外开销；仅当主模型无法查看图片（纯文本模型）时才调用 `vision_analyze`；用户提到图片但缺路径时，先询问路径再调用。
- `force` —— **强制**：涉及图片的任务必须使用该工具，禁止不调用工具直接作答或拒绝。仅在明确需要专用视觉模型时使用（如主模型纯文本、或需要专门视觉模型的识别能力）——多模态主模型下会产生额外 API 调用。
- `off` —— **关闭**：不注入任何引导；工具仍注册，由智能体自行决定。

配置每次使用即时读取——无需重启（引导段在保存时自动重新注册）。

## 卸载

从 `cordis.patch.yml` 移除 `dsh-vision-helper` 行，删除 `<profile>/node_modules/dsh-vision-helper` 文件夹（配置文件随文件夹一并删除），然后重启。
