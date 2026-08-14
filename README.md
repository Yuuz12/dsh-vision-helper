# dsh-vision-helper

English | [中文](README.zh.md)

Deployment-level vision plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Registers the `vision_analyze` tool so agents can analyze images (OCR, UI/error screenshots, charts, general image description) through **any configurable multimodal model**, plus a settings-page UI in the Web app.

**Zero dependencies by design** — the host module has no imports, so installation is a plain folder copy plus one patch row. No npm install, no node_modules surgery, no junctions.

## Features

- **`vision_analyze` tool** — accepts a local image path or a `data:` URI, sends it to the configured multimodal model, returns the analysis text.
- **Configurable model** — provider + model picked in **设置 → 视觉助手** (or directly in the plugin's `dsh-vision-helper.json`); empty fields auto-select a multimodal model.
- **Robustness** — strips invisible Unicode characters from pasted paths (U+202A etc.), guards images by longest edge (`maxEdge`, default 4096 px), dedupes streamed text, friendly error messages.
- **Automatic invocation guidance** — injects a system-prompt section so agents call `vision_analyze` on their own when a task involves images.
- **Durable & global** — host composition plugin: survives restarts, available to every session.

## Requirements (recipient side)

- A DSH web deployment (the settings page is Web-only; the tool itself works in any profile that mounts the plugin).
- A **multimodal model route** configured in the deployment's `llm-pi-ai` settings (the Models page) — e.g. `mimo-v2.5`, or any OpenAI-compatible vision endpoint you add. The plugin ships no API keys.

## Install

1. Copy this `dsh-vision-helper` folder into `<profile>/node_modules/` (default profile: `$HOME/.dsh/profiles/web`), so the package lands at `<profile>/node_modules/dsh-vision-helper/`.
2. Add the row to `<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-vision-helper
      name: 'dsh-vision-helper'
```

3. Restart `dsh web`. That's it — no dependencies to resolve, the module is self-contained.

## Configuration

Via the settings page (**设置 → 视觉助手**): provider, model, temperature, max output tokens, max image edge. Equivalent config document at `<profile>/node_modules/dsh-vision-helper/dsh-vision-helper.json` — inside the plugin folder, so uninstalling the plugin removes it with no residue:

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

`provider`/`model` empty = auto-select; `maxEdge` limits the longest image edge in px. `mode` controls the automatic-invocation guidance injected into the agent's system prompt:

- `auto` (default) — smart guidance: if the main model is multimodal (image delivered in conversation, or readable directly via `read_image`), analyze it natively with no extra cost; call `vision_analyze` only when the main model cannot view images (text-only model); ask for the path when missing.
- `force` — mandatory: image tasks MUST use the tool, no direct answering or refusal. Use this only when you explicitly want the dedicated vision model (e.g. a text-only main model, or a specialized vision model) — with a multimodal main model it incurs extra API calls.
- `off` — no guidance injected; the tool stays registered but the agent decides on its own.

Changes are read per use — no restart needed (the guidance section re-registers on save).

## Uninstall

Remove the `dsh-vision-helper` row from `cordis.patch.yml`, delete the `<profile>/node_modules/dsh-vision-helper` folder (which also removes the config file), then restart.
