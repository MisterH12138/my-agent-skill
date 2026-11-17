/**
 * 平台定义与端点推断
 *
 * 不绑定任何特定工具。所有平台都按 OpenAI 兼容接口处理，
 * 这样一套逻辑可覆盖绝大多数实际情况。
 */

/** 已知平台的端点与探活方式 */
export const PLATFORMS = {
  qianwen: {
    label: '千问 / 阿里云 DashScope',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    tokenPlanBase: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    envKeys: ['DASHSCOPE_API_KEY', 'QIANWEN_API_KEY'],
    healthPath: '/models',
    authStyle: 'bearer',
    keyPrefixes: {
      'sk-sp-': 'token-plan', // Token Plan 必须走专属端点
      'sk-ws-': 'payg',
      'sk-': 'payg',
    },
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    balanceBase: 'https://api.deepseek.com',
    envKeys: ['DEEPSEEK_API_KEY'],
    healthPath: '/models',
    authStyle: 'bearer',
  },
  openrouter: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    envKeys: ['OPENROUTER_API_KEY'],
    healthPath: '/models',
    authStyle: 'bearer',
    extraHeaders: { 'HTTP-Referer': 'https://github.com/dsh-skills', 'X-Title': 'keykeeper' },
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    envKeys: ['OPENAI_API_KEY'],
    healthPath: '/models',
    authStyle: 'bearer',
  },
  moonshot: {
    label: 'Moonshot Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    envKeys: ['MOONSHOT_API_KEY'],
    healthPath: '/models',
    authStyle: 'bearer',
  },
  zhipu: {
    label: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    envKeys: ['ZHIPU_API_KEY'],
    healthPath: '/models',
    authStyle: 'bearer',
  },
  siliconflow: {
    label: '硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    envKeys: ['SILICONFLOW_API_KEY'],
    healthPath: '/models',
    authStyle: 'bearer',
  },
  minimax: {
    label: 'MiniMax',
    baseURL: 'https://api.minimax.chat/v1',
    envKeys: ['MINIMAX_API_KEY'],
    healthPath: '/models',
    authStyle: 'bearer',
  },
  ollama: {
    label: 'Ollama（本地）',
    baseURL: 'http://localhost:11434/v1',
    envKeys: [],
    healthPath: '/models',
    authStyle: 'none',
    requiresKey: false,
  },
};

/**
 * 按 Key 前缀推断应使用的端点。
 * 这是本项目最实用的一条：sk-sp- 走错端点会直接 401。
 *
 * @param {string} platformId
 * @param {string} apiKey
 * @returns {{baseURL:string, kind:string, reason:string}}
 */
export function resolveEndpoint(platformId, apiKey) {
  const p = PLATFORMS[platformId];
  if (!p) {
    return { baseURL: null, kind: 'unknown', reason: `未知平台 ${platformId}` };
  }

  if (!apiKey) {
    return { baseURL: p.baseURL, kind: 'default', reason: '无 Key，使用默认端点' };
  }

  // 千问：按前缀分流
  if (platformId === 'qianwen' && p.keyPrefixes) {
    for (const [prefix, kind] of Object.entries(p.keyPrefixes)) {
      if (apiKey.startsWith(prefix)) {
        if (kind === 'token-plan' && p.tokenPlanBase) {
          return {
            baseURL: p.tokenPlanBase,
            kind: 'token-plan',
            reason: `Key 前缀 ${prefix} → Token Plan 专属端点`,
          };
        }
        return {
          baseURL: p.baseURL,
          kind,
          reason: `Key 前缀 ${prefix} → 按量付费端点`,
        };
      }
    }
  }

  return { baseURL: p.baseURL, kind: 'default', reason: '使用默认端点' };
}

/** 脱敏显示 Key */
export function maskKey(key) {
  if (!key) return '<未设置>';
  const s = String(key);
  if (s.length <= 12) return '****';
  return `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} 字符)`;
}

/** 判断 Key 是否明显是占位符 */
export function isPlaceholder(key) {
  if (!key) return true;
  return /your[-_]?key|placeholder|xxx+|sk-your/i.test(key);
}

/** 列出所有平台 ID */
export function listPlatformIds() {
  return Object.keys(PLATFORMS);
}
