// Tool Activity 安全视图模型（issue #33）
//
// 定位：把内部 ToolCall 投影成“可安全进入 UI”的活动记录——只暴露白名单
// 参数、结果形态与计数，绝不把原始 args/result（可能含 credential、内部
// 字段、CoT 痕迹）直接交给 renderer。与 #19 redaction 的定位一致，但属于
// 展示投影层：不修改内部数据，只决定 UI 能看到什么。
//
// 与 #27 stream-events 的关系：tool_started / tool_result 事件负载最终会
// 是同类 ToolCall 形状，本模型的 toToolActivity() 可作为统一的展示投影，
// 迁移期间与旧 AgentEvent 体系并存。

/** UI 可展示的工具活动状态（ToolCall.status 超集：补 cancelled）。 */
export type ToolActivityStatus = 'running' | 'success' | 'error' | 'cancelled';

/** 活动固定身份：runId + callId 决定卡片唯一性，streaming 更新不重复插入。 */
export interface ToolActivity {
  id: string;
  toolName: string;
  status: ToolActivityStatus;
  startedAt: number;
  completedAt?: number;
  /** 毫秒时长；仍在运行时为 undefined（UI 实时推算）。 */
  durationMs?: number;
  /** 白名单参数摘要：只含 symbol/period/limit 等安全字段。 */
  args: Record<string, unknown>;
  /** 结果形态摘要（如 "3 rows" / "object · 5 keys"），无原始值。 */
  resultSummary?: string;
  /** 同一 run 内该工具曾失败后再次执行（retry 可被用户识别）。 */
  retried: boolean;
  /** 数据源回退标记（fallback，当前适配器暂无数据，预留字段）。 */
  fallback: boolean;
  /** 证据 id（联动 #30 Source Inspector 时填充）。 */
  evidenceIds: string[];
  /** 脱敏后的错误原因（错误文本过 secret 过滤）。 */
  error?: { code: string; message: string };
  /** 分类（market/company/research/…），供图标与分组使用。 */
  category: string;
}

/** 仅这些参数键允许进入 UI；其余键（凭证、内部字段、敏感输入）一律丢弃。 */
const SAFE_ARG_KEYS = new Set([
  'symbol',
  'period',
  'limit',
  'market',
  'currency',
  'universe',
  'strategy',
  'horizon',
  'count',
]);

/** 凭证形状字段名，命中即丢弃（即使被白名单误放）。 */
const SECRET_ARG_KEYS = new Set([
  'apikey',
  'api_key',
  'authorization',
  'token',
  'secret',
  'password',
  'credential',
  'cookie',
]);

/** 过滤掉凭证形状文本的最小过滤器（Bearer/key/JWT 形态）。 */
export function redactSecretShapes(text: string): string {
  return text
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/g, '$1[REDACTED]')
    .replace(/\b(sk-|rk-|pk-|ak-)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

/** 生成白名单参数摘要：未知键丢弃，已知键浅拷贝（字符串截断防超长）。 */
export function safeArgSummary(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    const leaf = key.toLowerCase();
    if (SECRET_ARG_KEYS.has(leaf) || /(key|token|secret|password|bearer)$/.test(leaf)) continue;
    if (!SAFE_ARG_KEYS.has(key) && !SAFE_ARG_KEYS.has(leaf)) continue;
    if (Array.isArray(value)) {
      out[key] = `[${value.length}]`;
    } else if (typeof value === 'string') {
      out[key] = value.length > 24 ? `${value.slice(0, 24)}…` : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

/** 把原始结果折叠成“形态 + 计数”的文本摘要，不含任何字段值。 */
export function summarizeResult(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  if (Array.isArray(result)) {
    return result.length > 0 ? `${result.length} rows` : 'empty';
  }
  if (typeof result === 'object') {
    const keys = Object.keys(result as Record<string, unknown>);
    return keys.length > 0 ? `object · ${keys.length} keys` : 'empty object';
  }
  if (typeof result === 'string') {
    return result.length > 0 ? `${result.length} chars` : 'empty';
  }
  return String(result);
}

/** 从 ToolCall 形状投影为安全的 ToolActivity 记录。 */
export function toToolActivity(
  call: {
    id: string;
    toolName: string;
    status: 'running' | 'success' | 'error' | 'cancelled' | string;
    startedAt: number;
    completedAt?: number;
    args?: Record<string, unknown>;
    result?: unknown;
    error?: { code: string; message: string } | null;
  },
  category?: string
): ToolActivity {
  const status = normalizeActivityStatus(call.status);
  const error = call.error
    ? { code: call.error.code, message: redactSecretShapes(call.error.message) }
    : undefined;
  return {
    id: call.id,
    toolName: call.toolName,
    status,
    startedAt: call.startedAt,
    completedAt: call.completedAt,
    durationMs: call.completedAt !== undefined ? Math.max(0, call.completedAt - call.startedAt) : undefined,
    args: safeArgSummary(call.args ?? {}),
    resultSummary: status === 'success' ? summarizeResult(call.result) : undefined,
    retried: false,
    fallback: false,
    evidenceIds: [],
    error,
    category: category ?? 'other',
  };
}

/** running/success/error 直通；其余视为 cancelled（兼容运行中被中断的工具）。 */
function normalizeActivityStatus(status: string): ToolActivityStatus {
  if (status === 'running' || status === 'success' || status === 'error') return status;
  return 'cancelled';
}