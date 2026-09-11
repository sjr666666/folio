// Tool Activity 安全视图模型 — 投影与脱敏测试（issue #33）
import { describe, expect, it } from 'bun:test';
import { redactSecretShapes, safeArgSummary, summarizeResult, toToolActivity } from './tool-activity.ts';

describe('safeArgSummary', () => {
  it('只暴露白名单参数', () => {
    const args = safeArgSummary({ symbol: 'AAPL.US', period: '1d', limit: 30, internalTag: 'x' });
    expect(args).toEqual({ symbol: 'AAPL.US', period: '1d', limit: 30 });
    expect('internalTag' in args).toBe(false);
  });

  it('丢弃凭证形状字段（即使近似白名单名）', () => {
    const args = safeArgSummary({ apiKey: 'sk-12345', token: 'abc', symbol: 'AAPL.US' });
    expect(args).toEqual({ symbol: 'AAPL.US' });
  });

  it('数组参数折叠为计数，长字符串截断', () => {
    const args = safeArgSummary({ universe: ['a', 'b', 'c'], symbol: 'THIS.IS.A.VERY.LONG.SYMBOL.NAME' });
    expect(args.universe).toBe('[3]');
    expect(String(args.symbol).endsWith('…')).toBe(true);
  });
});

describe('summarizeResult', () => {
  it('数组 → 行数', () => {
    expect(summarizeResult([1, 2, 3])).toBe('3 rows');
  });
  it('对象 → keys 数', () => {
    expect(summarizeResult({ a: 1, b: 2 })).toBe('object · 2 keys');
  });
  it('原始值不泄露', () => {
    expect(summarizeResult('secret content')).toBe('14 chars');
    expect(summarizeResult(undefined)).toBeUndefined();
  });
});

describe('redactSecretShapes', () => {
  it('过滤 Bearer / sk- / JWT 形态文本', () => {
    expect(redactSecretShapes('Authorization: Bearer abcdef1234567890')).toContain('[REDACTED]');
    expect(redactSecretShapes('key=sk-ant-abcdef12345678')).toContain('[REDACTED]');
    expect(redactSecretShapes('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')).toBe('[REDACTED]');
  });
  it('普通文本原样保留', () => {
    expect(redactSecretShapes('symbol AAPL.US not found')).toBe('symbol AAPL.US not found');
  });
});

describe('toToolActivity', () => {
  it('映射状态、时长与白名单参数', () => {
    const activity = toToolActivity({
      id: 'c1',
      toolName: 'get_quote',
      status: 'success',
      startedAt: 1000,
      completedAt: 1500,
      args: { symbol: 'AAPL.US', apiKey: 'sk-12345678' },
      result: { symbol: 'AAPL.US', lastPrice: 190 },
    });
    expect(activity.status).toBe('success');
    expect(activity.durationMs).toBe(500);
    expect(activity.args).toEqual({ symbol: 'AAPL.US' });
    expect(activity.resultSummary).toBe('object · 2 keys');
  });

  it('running 状态无 resultSummary；cancelled 状态被识别', () => {
    const running = toToolActivity({ id: 'c2', toolName: 'get_news', status: 'running', startedAt: 1 });
    expect(running.resultSummary).toBeUndefined();
    expect(running.durationMs).toBeUndefined();
    const cancelled = toToolActivity({ id: 'c3', toolName: 'get_quote', status: 'interrupted', startedAt: 1 });
    expect(cancelled.status).toBe('cancelled');
  });

  it('错误消息过 secret 过滤', () => {
    const activity = toToolActivity({
      id: 'c4',
      toolName: 'get_quote',
      status: 'error',
      startedAt: 1,
      error: { code: 'PI_TOOL_ERROR', message: 'It exploded at Authorization: Bearer abcdefghijklmnop' },
    });
    expect(activity.error?.message).toContain('[REDACTED]');
    expect(activity.error?.message).not.toContain('abcdefghijklmnop');
  });
});