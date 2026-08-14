/**
 * dsh-vision-helper — persistent vision plugin for DeepSeek Harness.
 *
 * Zero-dependency by design: no imports, so installation is a plain folder
 * copy plus one cordis.patch.yml row. Configuration lives in the hosting
 * profile directory (`$DSH_HOME/profiles/<name>/dsh-vision-helper.json`),
 * read per use and
 * writable through the same-origin endpoint the settings page uses.
 */

export const name = 'dsh-vision-helper'

export const inject = ['tools', 'systemPrompt', 'fs', 'llm', 'attachments', 'webServer']

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

function guessMediaType(name) {
  const lower = String(name || '').toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return null
  return IMAGE_TYPES[lower.slice(dot + 1)] || null
}

function readU32(d, o) {
  return (((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3])) >>> 0
}

/** Parse intrinsic dimensions out of PNG/JPEG/WebP/GIF headers without decoding. */
function parseImageDimensions(data) {
  if (!data || data.length < 24) return null
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return { width: readU32(data, 16), height: readU32(data, 20) }
  }
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return { width: data[6] | (data[7] << 8), height: data[8] | (data[9] << 8) }
  }
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    const tag = String.fromCharCode(data[12], data[13], data[14], data[15])
    if (tag === 'VP8 ' && data.length >= 30) {
      return { width: data[26] | ((data[27] & 0x3f) << 8), height: data[28] | ((data[29] & 0x3f) << 8) }
    }
    if (tag === 'VP8L' && data.length >= 25) {
      const b = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24)
      return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 }
    }
    if (tag === 'VP8X' && data.length >= 30) {
      return {
        width: (data[24] | (data[25] << 8) | (data[26] << 16)) + 1,
        height: (data[27] | (data[28] << 8) | (data[29] << 16)) + 1,
      }
    }
    return null
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let off = 2
    while (off + 9 < data.length) {
      if (data[off] !== 0xff) { off++; continue }
      const marker = data[off + 1]
      if (marker === 0xd8) { off += 2; continue }
      if (marker === 0xd9 || marker === 0xda) break
      const len = (data[off + 2] << 8) | data[off + 3]
      if (len < 2) break
      const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
      if (sof && len >= 7) {
        return { height: (data[off + 5] << 8) | data[off + 6], width: (data[off + 7] << 8) | data[off + 8] }
      }
      off += 2 + len
    }
    return null
  }
  return null
}

function base64ToBytes(b64) {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bytes = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < b64.length; i++) {
    const ch = b64[i]
    if (ch === '=') break
    const v = table.indexOf(ch)
    if (v < 0) continue
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

const CONFIG_DEFAULTS = {
  provider: '',
  model: '',
  temperature: 0.2,
  maxTokens: 1024,
  maxEdge: 4096,
  mode: 'auto',
}

const GUIDANCE_MODES = ['off', 'auto', 'force']

const GUIDANCE_TEXTS = {
  auto: '当任务涉及图片（用户提供图片路径或附件、要求 OCR/识别图片内容、理解图表/UI/报错截图、描述图像细节等）时：如果主模型是多模态（图片随对话送达，或可通过 read_image 等工具直接查看本地图片），直接查看并分析即可，不要额外调用视觉工具；只有当主模型无法查看图片内容（纯文本模型）时，才调用 vision_analyze 工具分析图片；若用户提到图片但未给出可访问的本地路径或 data URI，先向用户询问图片路径，再调用对应工具。',
  force: '当任务涉及图片（用户提供图片路径或附件、要求 OCR/识别图片内容、理解图表/UI/报错截图、描述图像细节等）时，【必须】使用 vision_analyze 工具分析图片：禁止不调用该工具就直接回答图片内容，也禁止声称无法查看图片。如果用户提到图片但未给出可访问的本地路径或 data URI，先向用户询问图片路径，再调用该工具。',
}

/**
 * The module's own directory, derived from import.meta.url (pure string ops,
 * no imports).
 */
function pluginDir() {
  try {
    let url = import.meta.url
    const q = url.indexOf('?')
    if (q !== -1) url = url.slice(0, q)
    const h = url.indexOf('#')
    if (h !== -1) url = url.slice(0, h)
    if (url.startsWith('file://')) {
      let p = url.slice('file://'.length)
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1) // Windows: '/C:/...' -> 'C:/...'
      p = decodeURIComponent(p)
      const slash = p.lastIndexOf('/')
      if (slash > 0) return p.slice(0, slash)
    }
  } catch (e) { /* fall through to the home fallback */ }
  return null
}

/**
 * The hosting profile directory ($DSH_HOME/profiles/<name>), derived from the
 * module path. The config document lives HERE, not in the plugin folder:
 * pnpm-managed installs place package files in a content-addressed store that
 * updates replace, while the profile directory is user-owned and stable.
 */
function profileDir() {
  const dir = pluginDir()
  if (!dir) return null
  const marker = '/profiles/'
  const idx = dir.indexOf(marker)
  if (idx === -1) return null
  const rest = dir.slice(idx + marker.length)
  const slash = rest.indexOf('/')
  return slash === -1 ? dir : dir.slice(0, idx + marker.length + slash)
}

function configPath() {
  const dir = profileDir() || pluginDir()
  if (dir) return dir + '/dsh-vision-helper.json'
  // Fallback for exotic loaders where import.meta.url is not a file URL.
  const home = process.env.DSH_HOME
    || ((process.env.USERPROFILE || process.env.HOME || '.') + '/.dsh')
  return home.replace(/\\/g, '/').replace(/\/+$/, '') + '/dsh-vision-helper.json'
}

async function readConfig(ctx) {
  let raw = null
  try {
    const target = await ctx.fs.resolve(configPath())
    raw = await ctx.fs.readText(target)
  } catch (e) {
    raw = null
  }
  let parsed = null
  if (raw) {
    try { parsed = JSON.parse(raw) } catch (e) { parsed = null }
  }
  if (!parsed || typeof parsed !== 'object') return { ...CONFIG_DEFAULTS }
  return {
    provider: typeof parsed.provider === 'string' ? parsed.provider : '',
    model: typeof parsed.model === 'string' ? parsed.model : '',
    temperature: typeof parsed.temperature === 'number' ? parsed.temperature : CONFIG_DEFAULTS.temperature,
    maxTokens: typeof parsed.maxTokens === 'number' ? parsed.maxTokens : CONFIG_DEFAULTS.maxTokens,
    maxEdge: typeof parsed.maxEdge === 'number' ? parsed.maxEdge : CONFIG_DEFAULTS.maxEdge,
    mode: GUIDANCE_MODES.includes(parsed.mode) ? parsed.mode : CONFIG_DEFAULTS.mode,
  }
}

async function writeConfig(ctx, cfg) {
  const target = await ctx.fs.resolve(configPath())
  await ctx.fs.writeText(target, JSON.stringify(cfg, null, 2), undefined, undefined, { mode: 'danger-full-access' })
}

export async function apply(ctx) {
  // Guidance injection follows the `mode` setting: off = no prompt section,
  // auto = soft guidance, force = mandatory instruction. Re-registered on
  // every config write so a mode change applies without a restart.
  let guidanceDispose = null
  function refreshGuidance(mode) {
    if (guidanceDispose) {
      guidanceDispose()
      guidanceDispose = null
    }
    if (mode === 'off') return
    guidanceDispose = ctx.systemPrompt.section({
      name: 'vision-guidance',
      order: 150,
      text: GUIDANCE_TEXTS[mode] || GUIDANCE_TEXTS.auto,
    })
  }
  refreshGuidance((await readConfig(ctx)).mode)

  async function listProvidersState() {
    const out = []
    let providers = []
    try { providers = await ctx.llm.listProviders() } catch (e) { return [] }
    for (const p of providers) {
      let models = []
      try {
        models = (await ctx.llm.listModels(p.id)).map((m) => ({
          id: m.id,
          name: m.name,
          image: Array.isArray(m.inputModalities) ? m.inputModalities.includes('image') : null,
        }))
      } catch (e) { models = [] }
      out.push({ id: p.id, name: p.name, models })
    }
    return out
  }

  function effectiveSelection(providers, cfg) {
    if (!providers.length) return { provider: null, model: null }
    let provider = null
    if (cfg.provider && providers.some((p) => p.id === cfg.provider)) provider = cfg.provider
    if (!provider) {
      const preferred = providers.find((p) => p.id === 'opencode-go')
      provider = (preferred || providers[0]).id
    }
    const p = providers.find((x) => x.id === provider)
    let model = null
    if (cfg.model && p.models.some((m) => m.id === cfg.model)) model = cfg.model
    if (!model) {
      const vision = p.models.find((m) => m.image === true)
      model = (vision || p.models[0] || null) ? (vision || p.models[0]).id : null
    }
    return { provider, model }
  }

  // Same-origin config endpoint for the settings page. Reads/writes
  // Profile-dir dsh-vision-helper.json — the same document the tool consumes.
  function sendJson(res, status, body) {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(text)
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-vision-helper/config',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const providers = await listProvidersState()
          const cfg = await readConfig(ctx)
          const effective = effectiveSelection(providers, cfg)
          sendJson(res, 200, { config: cfg, effective, providers })
          return
        }
        if (req.method === 'POST') {
          const raw = await readBody(req)
          let body = {}
          if (raw.trim()) {
            try { body = JSON.parse(raw) } catch (e) {
              sendJson(res, 400, { error: '请求体不是有效 JSON' })
              return
            }
          }
          const cfg = await readConfig(ctx)
          if (body.provider !== undefined) cfg.provider = typeof body.provider === 'string' ? body.provider : ''
          if (body.model !== undefined) cfg.model = typeof body.model === 'string' ? body.model : ''
          if (body.temperature !== undefined) {
            const t = Number(body.temperature)
            if (!Number.isFinite(t) || t < 0 || t > 2) { sendJson(res, 400, { error: 'temperature 必须是 0-2 之间的数字' }); return }
            cfg.temperature = t
          }
          if (body.maxTokens !== undefined) {
            const n = Number(body.maxTokens)
            if (!Number.isInteger(n) || n < 1 || n > 32768) { sendJson(res, 400, { error: 'maxTokens 必须是 1-32768 之间的整数' }); return }
            cfg.maxTokens = n
          }
          if (body.maxEdge !== undefined) {
            const e = Number(body.maxEdge)
            if (!Number.isFinite(e) || e < 512 || e > 16384) { sendJson(res, 400, { error: 'maxEdge 必须是 512-16384 之间的数字' }); return }
            cfg.maxEdge = e
          }
          if (body.mode !== undefined) {
            if (!GUIDANCE_MODES.includes(body.mode)) { sendJson(res, 400, { error: 'mode 必须是 off/auto/force 之一' }); return }
            cfg.mode = body.mode
          }
          await writeConfig(ctx, cfg)
          refreshGuidance(cfg.mode)
          const providers = await listProvidersState()
          const effective = effectiveSelection(providers, cfg)
          sendJson(res, 200, { config: cfg, effective, providers })
          return
        }
        sendJson(res, 405, { error: '仅支持 GET/POST' })
      } catch (e) {
        sendJson(res, 400, { error: e && e.message ? e.message : String(e) })
      }
    },
  })

  ctx.tools.register({
    name: 'vision_analyze',
    description: '使用已配置的多模态视觉模型分析图片并返回文字结果。适用于识别图片内容与场景、读取截图/文档中的文字（OCR）、理解图表/UI/报错截图、描述图像细节。image 参数接受本地图片的绝对路径（推荐）或 data:image/...;base64,... 数据 URI；分析网络图片前请先用其他工具下载到本地。配置在 profile 目录下的 dsh-vision-helper.json：provider/model 留空自动选择多模态模型，maxEdge 限制最长边像素（默认 4096）。',
    parameters: {
      type: 'object',
      properties: {
        image: { type: 'string', description: '本地图片的绝对路径，或 data:image/png;base64,... 形式的数据 URI' },
        prompt: { type: 'string', description: '对图片的具体分析要求，如“提取图中所有文字”“这张报错截图的问题是什么”。不传时模型给出全面的图片描述' },
      },
      required: ['image'],
    },
    output: {
      schema: { type: 'string' },
      render(_args, value) { return [{ type: 'text', text: value }] },
    },
    async execute(args, exec) {
      const signal = (exec && exec.signal) || undefined
      // Strip invisible Unicode formatting/zero-width characters that sneak in
      // when a path is copy-pasted (U+202A LRE, zero-width spaces, etc.).
      const imageArg = String((args && args.image) || '').trim().replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
      if (!imageArg) throw new Error('缺少 image 参数：请提供本地图片路径或 data URI')
      const prompt = (args && typeof args.prompt === 'string' && args.prompt.trim())
        ? args.prompt.trim()
        : '请详细描述这张图片的内容，包括场景、主体、可见文字（如有）等所有重要细节。'

      const providers = await listProvidersState()
      if (!providers.length) throw new Error('当前没有任何已注册的模型提供方，无法调用视觉模型。')
      const cfg = await readConfig(ctx)
      const sel = effectiveSelection(providers, cfg)
      if (!sel.provider || !sel.model) throw new Error('没有可用的视觉模型。请在「设置 → 视觉助手」中配置 provider/model。')
      const provider = sel.provider
      const model = sel.model

      let data
      let mediaType
      if (imageArg.startsWith('data:')) {
        const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/.exec(imageArg)
        if (!m) throw new Error('data URI 格式无效，应为 data:image/png;base64,... 形式')
        mediaType = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase()
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) throw new Error('不支持的图片类型 ' + mediaType + '（仅支持 png/jpeg/webp/gif）')
        data = base64ToBytes(m[2])
        if (!data.length) throw new Error('data URI 未包含图片数据')
      } else {
        const target = await ctx.fs.resolve(imageArg)
        const info = await ctx.fs.stat(target)
        if (!info) throw new Error('文件不存在: ' + imageArg)
        mediaType = guessMediaType(imageArg)
        if (!mediaType) throw new Error('无法识别图片格式（支持 .png/.jpg/.jpeg/.webp/.gif）。请提供带正确扩展名的文件路径。')
        const limit = ctx.attachments.imageLimits.maxImageBytes
        try {
          data = await ctx.fs.readBytes(target, signal, limit)
        } catch (e) {
          const msg = e && e.message ? e.message : String(e)
          if (msg.indexOf('exceeds') >= 0 || msg.indexOf('TOO_LARGE') >= 0) {
            throw new Error('图片文件超过附件读取上限（' + Math.round(limit / 1048576) + ' MB），请先压缩图片再分析。')
          }
          throw e
        }
      }

      const dims = parseImageDimensions(data)
      if (dims && dims.width > 0 && dims.height > 0) {
        const longestEdge = Math.max(dims.width, dims.height)
        if (longestEdge > cfg.maxEdge) {
          throw new Error('图片过长（最长边 ' + longestEdge + 'px，' + dims.width + '×' + dims.height + '），超过当前配置的上限（' + cfg.maxEdge + 'px）。如需分析更大的图片，请在「设置 → 视觉助手」调高 maxEdge，或先缩小图片再分析。')
        }
      }

      let ref
      try {
        ref = await ctx.attachments.saveImage({ data, mediaType, name: 'vision-input' })
      } catch (e) {
        throw new Error('图片校验失败（' + (e && e.message ? e.message : String(e)) + '）。图片可能过大或不是有效图像。')
      }

      const message = {
        id: 'vision-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
        role: 'user',
        content: [
          { type: 'image', attachment: ref },
          { type: 'text', text: prompt },
        ],
        source: { kind: 'user' },
      }

      let text = ''
      const deltaIndexes = new Set()
      const chunks = ctx.llm.stream({
        provider,
        model,
        messages: [message],
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
        signal,
      })
      for await (const chunk of chunks) {
        if (chunk.type === 'text-delta') {
          deltaIndexes.add(chunk.index)
          text += chunk.text
        } else if (chunk.type === 'block-end' && chunk.block.type === 'text') {
          if (!deltaIndexes.has(chunk.index)) text += chunk.block.text
        } else if (chunk.type === 'finish') {
          if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
            const failure = chunk.reason.failure || {}
            throw new Error('视觉模型调用失败 [' + (failure.code || chunk.reason.kind) + ']: ' + (failure.message || '未知错误'))
          }
        }
      }
      const result = text.trim()
      if (!result) throw new Error('视觉模型未返回任何文字内容。可能原因：所选模型不支持图片输入、图片过长，或模型拒绝了该请求。请在「设置 → 视觉助手」更换 model 或调高 maxEdge 后重试。')
      return result
    },
  })
}
