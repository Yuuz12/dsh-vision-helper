window.__ModuleLoader__.load({
	id: 'dsh-vision-helper',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		let react = require('react');

		const inject = ['slots'];

		const CSS = [
			'.vsp-section { display: flex; flex-direction: column; gap: 14px; max-width: 560px; padding: 4px 2px; }',
			'.vsp-intro { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #888); }',
			'.vsp-row { display: flex; flex-direction: column; gap: 5px; }',
			'.vsp-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }',
			'.vsp-select, .vsp-input { box-sizing: border-box; width: 100%; padding: 7px 9px; font-size: 13px; color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-2, #fff); border: 1px solid var(--dsw-alias-border-l1, #ccc); border-radius: 4px; }',
			'/* 深色模式下浏览器自动填充会把输入框刷成白色/黄色：inset 大阴影 + text-fill-color 回压为当前主题输入底色 */',
			'.vsp-input:-webkit-autofill, .vsp-input:-webkit-autofill:hover, .vsp-input:-webkit-autofill:focus { -webkit-text-fill-color: var(--dsw-alias-label-primary, #222); -webkit-box-shadow: 0 0 0 1000px var(--dsw-alias-bg-layer-2, #fff) inset; box-shadow: 0 0 0 1000px var(--dsw-alias-bg-layer-2, #fff) inset; caret-color: var(--dsw-alias-label-primary, #222); transition: background-color 999999s ease-in-out 0s; }',
			'.vsp-rowline { display: flex; gap: 14px; }',
			'.vsp-rowline .vsp-row { flex: 1; }',
			'.vsp-save { align-self: flex-start; padding: 7px 18px; font-size: 13px; cursor: pointer; color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l2, #999); border-radius: 4px; }',
			'.vsp-save:disabled { opacity: 0.55; cursor: default; }',
			'.vsp-msg { margin: 0; font-size: 12px; color: var(--dsw-alias-state-success-primary, #1a7f37); }',
			'.vsp-err { margin: 0; font-size: 12px; color: var(--dsw-alias-state-error-primary, #d1242f); white-space: pre-wrap; }',
			'.vsp-hint { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #888); border-top: 1px solid var(--dsw-alias-border-l1, #e5e5e5); padding-top: 10px; }',
		].join('\n');

		function apply(ctx) {
			const styleEl = document.createElement('style');
			styleEl.setAttribute('data-plugin', 'dsh-vision-helper');
			styleEl.textContent = CSS;
			document.head.appendChild(styleEl);
			ctx.effect(() => () => {
				if (styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl);
			}, 'dsh-vision-helper: styles');

			const ENDPOINT = '/dsh-vision-helper/config';

			function VisionSettings() {
				const [state, setState] = react.useState(null);
				const [provider, setProvider] = react.useState('');
				const [model, setModel] = react.useState('');
				const [temperature, setTemperature] = react.useState('0.2');
				const [maxTokens, setMaxTokens] = react.useState('1024');
				const [maxEdge, setMaxEdge] = react.useState('4096');
				const [mode, setMode] = react.useState('auto');
				const [busy, setBusy] = react.useState(false);
				const [message, setMessage] = react.useState('');
				const [error, setError] = react.useState('');

				react.useEffect(() => {
					let alive = true;
					fetch(ENDPOINT).then((r) => r.json()).then((s) => {
						if (!alive) return;
						setState(s);
						const cfg = (s && s.config) || {};
						setProvider(typeof cfg.provider === 'string' ? cfg.provider : '');
						setModel(typeof cfg.model === 'string' ? cfg.model : '');
						setTemperature(String(typeof cfg.temperature === 'number' ? cfg.temperature : 0.2));
						setMaxTokens(String(typeof cfg.maxTokens === 'number' ? cfg.maxTokens : 1024));
						setMaxEdge(String(typeof cfg.maxEdge === 'number' ? cfg.maxEdge : 4096));
						setMode(cfg.mode === 'off' || cfg.mode === 'force' ? cfg.mode : 'auto');
					}).catch((e) => {
						if (!alive) return;
						setError('无法连接宿主配置端点：' + (e && e.message ? e.message : String(e)) + '。请确认 dsh-vision-helper 插件已加载。');
					});
					return () => { alive = false; };
				}, []);

				const providers = (state && state.providers) || [];
				const activeProvider = providers.find((p) => p.id === provider) || null;
				const models = activeProvider ? activeProvider.models : [];
				const effective = (state && state.effective) || {};
				const manual = Boolean(state && state.config && state.config.provider && state.config.model);
				const ready = state !== null;

				function onProviderChange(value) {
					setProvider(value);
					const p = providers.find((x) => x.id === value);
					if (p && p.models.length) {
						const v = p.models.find((m) => m.image === true) || p.models[0];
						setModel(v.id);
					} else {
						setModel('');
					}
				}

				function onSave() {
					const t = Number(temperature);
					const mt = Number(maxTokens);
					const me = Number(maxEdge);
					if (!Number.isFinite(t) || t < 0 || t > 2) { setError('温度必须是 0-2 之间的数字'); return; }
					if (!Number.isInteger(mt) || mt < 1 || mt > 32768) { setError('最大输出 tokens 必须是 1-32768 之间的整数'); return; }
					if (!Number.isFinite(me) || me < 512 || me > 16384) { setError('最大边长必须是 512-16384 之间的数字'); return; }
					setBusy(true);
					setMessage('');
					setError('');
					fetch(ENDPOINT, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ provider, model, temperature: t, maxTokens: mt, maxEdge: me, mode }),
					}).then((r) => r.json()).then((s) => {
						if (s && s.error) {
							setError('保存失败：' + s.error);
							return;
						}
						setState(s);
						const cfg = (s && s.config) || {};
						setProvider(typeof cfg.provider === 'string' ? cfg.provider : '');
						setModel(typeof cfg.model === 'string' ? cfg.model : '');
						setMessage('已保存，配置已热重载生效');
					}).catch((e) => {
						setError('保存失败：' + (e && e.message ? e.message : String(e)));
					}).finally(() => setBusy(false));
				}

				function row(label, control) {
					return react.createElement('div', { className: 'vsp-row' },
						react.createElement('label', { className: 'vsp-label' }, label),
						control
					);
				}

				function rowline(first, second) {
					return react.createElement('div', { className: 'vsp-rowline' }, first, second);
				}

				return react.createElement('div', { className: 'vsp-section' },
					react.createElement('p', { className: 'vsp-intro' },
						'为智能体提供图片识别能力：vision_analyze 工具调用你选择的多模态模型分析图片（识别内容 / OCR 截图文字 / 理解图表与报错等）。留空的项自动选择。'
					),
					row('模型提供方（留空自动选择）',
						react.createElement('select', {
							className: 'vsp-select',
							value: provider,
							onChange: (e) => onProviderChange(e.target.value),
							disabled: busy || !ready || !providers.length,
						},
							react.createElement('option', { key: '', value: '' }, '（自动选择）'),
							providers.map((p) => react.createElement('option', { key: p.id, value: p.id },
								p.name + ' (' + p.id + ')' + (p.models.length ? ' · ' + p.models.length + ' 个模型' : '')
							))
						)
					),
					row('视觉模型（✓ 标注支持图片输入）',
						react.createElement('select', {
							className: 'vsp-select',
							value: model,
							onChange: (e) => setModel(e.target.value),
							disabled: busy || !ready || !activeProvider,
						},
							react.createElement('option', { key: '', value: '' }, '（自动选择）'),
							models.map((m) => react.createElement('option', { key: m.id, value: m.id },
								m.name + ' (' + m.id + ')' + (m.image === true ? ' ✓ 多模态' : m.image === false ? ' ⚠️ 仅文本' : '')
							))
						)
					),
					row('智能体调用辅助（提示词注入强度）',
						react.createElement('select', {
							className: 'vsp-select',
							value: mode,
							onChange: (e) => setMode(e.target.value),
							disabled: busy || !ready,
						},
							react.createElement('option', { key: 'auto', value: 'auto' }, '自动：主模型能直接看图就直读，看不了才调用 vision_analyze'),
							react.createElement('option', { key: 'force', value: 'force' }, '强制：涉及图片的任务必须调用 vision_analyze'),
							react.createElement('option', { key: 'off', value: 'off' }, '关闭：不注入引导提示词（工具仍可用）')
						)
					),
					rowline(
						row('温度（0-2）',
							react.createElement('input', { className: 'vsp-input', type: 'number', min: '0', max: '2', step: '0.1', value: temperature, onChange: (e) => setTemperature(e.target.value), disabled: busy || !ready })),
						row('最大输出 tokens',
							react.createElement('input', { className: 'vsp-input', type: 'number', min: '1', max: '32768', step: '1', value: maxTokens, onChange: (e) => setMaxTokens(e.target.value), disabled: busy || !ready }))
					),
					row('最大图片边长（px，最长边，默认 4096）',
						react.createElement('input', { className: 'vsp-input', type: 'number', min: '512', max: '16384', step: '1', value: maxEdge, onChange: (e) => setMaxEdge(e.target.value), disabled: busy || !ready })),
					react.createElement('div', { className: 'vsp-row' },
						react.createElement('button', { className: 'vsp-save', onClick: onSave, disabled: busy || !ready },
							busy ? '保存中…' : '保存配置'
						),
						message ? react.createElement('p', { className: 'vsp-msg' }, message) : null,
						error ? react.createElement('p', { className: 'vsp-err' }, error) : null
					),
					react.createElement('p', { className: 'vsp-hint' },
						'当前' + (manual ? '手动配置：' + provider + ' / ' + model : '自动选择：' + (effective.provider ? effective.provider + ' / ' + effective.model : '无可用模型')) + '，模式：' + (mode === 'force' ? '强制' : mode === 'off' ? '关闭' : '自动') + '。' +
						'配置保存在数据目录的 dsh-vision-helper.json（store 安装为 $DSH_HOME/profiles/<名称>/，link 安装为源码目录），随部署持久、更新不丢失，保存即时生效。提示：若列表里没有合适的视觉模型，可在「模型」设置页添加 OpenAI 兼容提供方后回到本页选择。'
					)
				);
			}

			ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: 'vision',
				order: 25,
				label: '视觉助手',
			}, VisionSettings));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
