import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Check, ChevronDown, LoaderCircle, RotateCcw, X } from 'lucide-react';
import type { ToolCall, ToolCallRecord } from '@finagent/core';
import { toToolActivity, type ToolActivity as ToolActivityModel } from '@finagent/core';
import { semanticToolCategory, semanticToolLabelKey } from '../../lib/agentPresentation';

type ToolCallLike = Pick<ToolCall, 'id' | 'toolName' | 'args' | 'startedAt' | 'completedAt' | 'status' | 'result' | 'error'>;

interface ToolActivityProps {
  /** 实时 run（ToolCall）或持久化消息（ToolCallRecord）统一接入。 */
  toolCalls: ToolCallLike[];
}

const StatusIcon: React.FC<{ status: ToolActivityModel['status'] }> = ({ status }) => {
  if (status === 'running') return <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />;
  if (status === 'success') return <Check className="h-3.5 w-3.5 shrink-0 text-positive" />;
  if (status === 'cancelled') return <Ban className="h-3.5 w-3.5 shrink-0 text-foreground/38" />;
  return <X className="h-3.5 w-3.5 shrink-0 text-negative" />;
};

function formatDuration(ms: number | undefined): string | null {
  if (ms === undefined) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Tool Activity 时间线（issue #33）。
 *
 * - 稳定身份：以 callId 为 key，streaming 状态更新在同一张卡上完成，永不重复插入；
 * - cancelled / error 状态显式呈现，不隐藏成普通成功；
 * - 默认只展示语义名称 + 安全摘要：白名单参数、结果计数、时长；
 *   展开后才展示脱敏后的错误与工具原始名（技术细节，非默认标签）；
 * - 复用同一组件渲染实时 run 与历史消息 → conversation reload 后时间线仍在。
 */
export const ToolActivity: React.FC<ToolActivityProps> = ({ toolCalls }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const activities = useMemo(
    () => toolCalls.map((call) => toToolActivity(call as Parameters<typeof toToolActivity>[0], semanticToolCategory(call.toolName))),
    [toolCalls]
  );
  if (activities.length === 0) return null;

  const running = activities.some((activity) => activity.status === 'running');
  const hasFailure = activities.some((activity) => activity.status === 'error' || activity.status === 'cancelled');
  const dotClass = running ? 'animate-pulse bg-accent' : hasFailure ? 'bg-negative' : 'bg-positive';

  return (
    <div data-testid="tool-activity-timeline" className="rounded-[9px] border border-border bg-surface-muted px-3 py-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={t('agent.tool.activityLabel')}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 text-left text-[11px] text-foreground/64"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        <span className="font-medium">
          {running
            ? t('agent.tool.running')
            : hasFailure
              ? t('agent.tool.summaryWithIssues', { count: activities.length })
              : t('agent.tool.analyzedSources', { count: activities.length })}
        </span>
        <span className="flex-1" />
        <ChevronDown className={`h-3.5 w-3.5 text-foreground/34 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2" data-testid="tool-activity-items">
          {activities.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </div>
  );
};

const ActivityRow: React.FC<{ activity: ToolActivityModel }> = ({ activity }) => {
  const { t } = useTranslation();
  const [details, setDetails] = useState(false);
  const symbol = typeof activity.args.symbol === 'string' ? activity.args.symbol : null;
  const duration = formatDuration(activity.durationMs);
  const argEntries = Object.entries(activity.args);

  return (
    <div key={activity.id} className="rounded-[7px] px-1.5 py-1 hover:bg-foreground/[0.04]">
      <button
        type="button"
        onClick={() => setDetails((value) => !value)}
        className="flex w-full items-center gap-2 text-left text-[11px]"
      >
        <StatusIcon status={activity.status} />
        <span className={`truncate ${activity.status === 'cancelled' ? 'text-foreground/46 line-through' : 'text-foreground/78'}`}>
          {t(semanticToolLabelKey(activity.toolName))}
        </span>
        {symbol && (
          <span className="rounded-[5px] bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-foreground/52">{symbol}</span>
        )}
        {duration && <span className="shrink-0 font-mono text-[9.5px] text-foreground/38">{duration}</span>}
        {activity.retried && (
          <span className="flex shrink-0 items-center gap-1 rounded-[5px] bg-warning/12 px-1.5 py-0.5 text-[9.5px] font-medium text-warning">
            <RotateCcw className="h-2.5 w-2.5" />
            {t('agent.tool.retried')}
          </span>
        )}
        <span className="flex-1" />
        {activity.status === 'running' && <span className="text-foreground/38">{t('agent.tool.statusRunning')}</span>}
        {activity.status === 'cancelled' && <span className="text-foreground/38">{t('agent.tool.statusCancelled')}</span>}
        {activity.status !== 'running' && activity.status !== 'cancelled' && (
          <ChevronDown className={`h-3 w-3 text-foreground/30 transition-transform ${details ? 'rotate-180' : ''}`} />
        )}
      </button>
      {details && (
        <div className="ml-6 mt-1 space-y-1 text-[10px] text-foreground/52">
          {activity.resultSummary && (
            <p className="flex items-center gap-1.5">
              <span className="font-semibold text-foreground/42">{t('agent.tool.resultSummary')}</span>
              <span className="font-mono">{activity.resultSummary}</span>
            </p>
          )}
          {argEntries.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-foreground/42">{t('agent.tool.argsSummary')}</span>
              {argEntries.map(([key, value]) => (
                <span key={key} className="rounded-[4px] bg-foreground/5 px-1 py-0.5 font-mono text-[9.5px] text-foreground/56">
                  {key}={String(value)}
                </span>
              ))}
            </p>
          )}
          {activity.error && (
            <p className="text-negative/80">
              <span className="font-semibold">{t('agent.tool.errorSummary')}</span> {activity.error.code}:{' '}
              {activity.error.message}
            </p>
          )}
          <p className="font-mono text-[9.5px] text-foreground/26">{activity.toolName}</p>
        </div>
      )}
    </div>
  );
};

/** 类型辅助：从 ToolCallRecord 数组构造 ToolActivity（历史消息接入）。 */
export function activityFromRecords(records: ToolCallRecord[]): ToolActivityModel[] {
  return records.map((record) =>
    toToolActivity(record as Parameters<typeof toToolActivity>[0], semanticToolCategory(record.toolName))
  );
}