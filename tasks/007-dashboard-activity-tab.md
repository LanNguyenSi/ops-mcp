# Task 007 — Dashboard Activity Tab

**Wave:** 3 — Dashboard + Polish  
**Status:** Ready  
**Assignee:** Ice  
**Estimated effort:** 3–4h  
**Depends on:** Task 003 (SSE endpoint must be deployed)

---

## Goal

Add an "Activity" tab to the `agent-ops-dashboard` (ops.opentriologue.ai) that shows a live feed of agent events via SSE. Users can filter by agent ID, event type, and time range.

---

## Route

New route: `/activity` in the Next.js app (App Router).

---

## File Structure

```
app/
├── activity/
│   └── page.tsx                    ← New: /activity route
├── components/
│   └── activity/
│       ├── ActivityFeed.tsx         ← SSE consumer + event list
│       ├── EventCard.tsx            ← Single event row
│       ├── EventFilters.tsx         ← Filter bar
│       ├── ConnectionBadge.tsx      ← Live/Disconnected indicator
│       └── useActivityStream.ts     ← Custom hook: SSE connection + state
└── layout.tsx                       ← Modify: add Activity nav link
```

---

## Navigation

Modify the main layout/navbar to add an "Activity" link next to "Agents":

```tsx
// In app/layout.tsx or components/Navbar.tsx
<nav>
  <Link href="/">Agents</Link>
  <Link href="/activity">Activity</Link>
</nav>
```

---

## `useActivityStream.ts`

Custom hook managing the SSE connection lifecycle:

```typescript
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface AgentEvent {
  id: number;
  agentId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityFilters {
  agentId?: string;
  eventType?: string;
}

export interface UseActivityStreamResult {
  events: AgentEvent[];
  isConnected: boolean;
  error: string | null;
  clearEvents: () => void;
}

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001';
const MAX_EVENTS = 200; // cap in-memory event list
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export function useActivityStream(filters: ActivityFilters = {}): UseActivityStreamResult {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastEventIdRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    // Build SSE URL with filters
    const params = new URLSearchParams();
    if (filters.agentId) params.set('agentId', filters.agentId);
    if (filters.eventType) params.set('eventType', filters.eventType);
    const url = `${GATEWAY_URL}/api/events/stream?${params.toString()}`;

    // EventSource doesn't natively support Last-Event-ID on manual reconnects
    // Use a custom header workaround via URL param
    const reconnectUrl = lastEventIdRef.current
      ? `${url}&lastEventId=${lastEventIdRef.current}`
      : url;

    const es = new EventSource(reconnectUrl);
    esRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0;
    };

    es.onmessage = (event) => {
      try {
        const data: AgentEvent = JSON.parse(event.data);
        lastEventIdRef.current = data.id;
        setEvents(prev => {
          const updated = [data, ...prev];
          return updated.slice(0, MAX_EVENTS); // newest first, capped
        });
      } catch {
        // Ignore malformed events
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();

      // Exponential backoff reconnect
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** reconnectAttemptsRef.current,
        RECONNECT_MAX_MS
      );
      reconnectAttemptsRef.current += 1;
      setError(`Disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [filters.agentId, filters.eventType]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, isConnected, error, clearEvents };
}
```

---

## `ConnectionBadge.tsx`

```tsx
'use client';

interface ConnectionBadgeProps {
  isConnected: boolean;
  error: string | null;
}

export function ConnectionBadge({ isConnected, error }: ConnectionBadgeProps) {
  if (isConnected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-amber-600">
      <span className="h-2 w-2 rounded-full bg-amber-500" />
      {error ?? 'Reconnecting...'}
    </span>
  );
}
```

---

## `EventFilters.tsx`

```tsx
'use client';

import { ActivityFilters } from './useActivityStream';

const EVENT_TYPES = [
  'agent.registered',
  'agent.heartbeat',
  'agent.disconnected',
  'state.set',
  'state.deleted',
  'state.cas.success',
  'state.cas.conflict',
];

interface EventFiltersProps {
  filters: ActivityFilters;
  onChange: (filters: ActivityFilters) => void;
  agentIds: string[]; // derived from seen events
}

export function EventFilters({ filters, onChange, agentIds }: EventFiltersProps) {
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      <select
        value={filters.agentId ?? ''}
        onChange={e => onChange({ ...filters, agentId: e.target.value || undefined })}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm"
      >
        <option value="">All Agents</option>
        {agentIds.map(id => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>

      <select
        value={filters.eventType ?? ''}
        onChange={e => onChange({ ...filters, eventType: e.target.value || undefined })}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm"
      >
        <option value="">All Event Types</option>
        {EVENT_TYPES.map(t => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    </div>
  );
}
```

---

## `EventCard.tsx`

```tsx
'use client';

import { AgentEvent } from './useActivityStream';

const EVENT_COLORS: Record<string, string> = {
  'agent.registered':   'border-l-blue-500 bg-blue-50',
  'agent.heartbeat':    'border-l-green-500 bg-green-50',
  'agent.disconnected': 'border-l-gray-400 bg-gray-50',
  'state.set':          'border-l-violet-500 bg-violet-50',
  'state.deleted':      'border-l-red-400 bg-red-50',
  'state.cas.success':  'border-l-emerald-500 bg-emerald-50',
  'state.cas.conflict': 'border-l-amber-500 bg-amber-50',
};

interface EventCardProps {
  event: AgentEvent;
}

export function EventCard({ event }: EventCardProps) {
  const colorClass = EVENT_COLORS[event.eventType] ?? 'border-l-gray-300 bg-gray-50';
  const time = new Date(event.createdAt).toLocaleTimeString();
  const payloadStr = JSON.stringify(event.payload);
  const truncated = payloadStr.length > 120 ? payloadStr.slice(0, 117) + '...' : payloadStr;

  return (
    <div className={`border-l-4 rounded-r p-3 ${colorClass} flex items-start gap-3`}>
      <span className="text-xs text-gray-500 whitespace-nowrap font-mono mt-0.5">{time}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {event.agentId && (
            <span className="text-xs font-semibold text-gray-700 bg-gray-200 rounded px-1.5 py-0.5">
              {event.agentId}
            </span>
          )}
          <span className="text-xs font-mono font-medium text-gray-800">
            {event.eventType}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5 font-mono truncate">{truncated}</p>
      </div>
      <span className="text-xs text-gray-400 font-mono">#{event.id}</span>
    </div>
  );
}
```

---

## `ActivityFeed.tsx`

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useActivityStream, ActivityFilters } from './useActivityStream';
import { EventCard } from './EventCard';
import { EventFilters } from './EventFilters';
import { ConnectionBadge } from './ConnectionBadge';

export function ActivityFeed() {
  const [filters, setFilters] = useState<ActivityFilters>({});
  const { events, isConnected, error, clearEvents } = useActivityStream(filters);

  // Derive unique agent IDs from seen events for the filter dropdown
  const agentIds = useMemo(
    () => [...new Set(events.map(e => e.agentId).filter(Boolean) as string[])],
    [events]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Activity Feed</h2>
        <div className="flex items-center gap-3">
          <ConnectionBadge isConnected={isConnected} error={error} />
          <button
            onClick={clearEvents}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Clear
          </button>
        </div>
      </div>

      <EventFilters filters={filters} onChange={setFilters} agentIds={agentIds} />

      {events.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">
          {isConnected ? 'Waiting for events...' : 'Connecting...'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {events.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## `app/activity/page.tsx`

```tsx
import { ActivityFeed } from '@/components/activity/ActivityFeed';

export const metadata = {
  title: 'Activity Feed — Triologue Ops',
};

export default function ActivityPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <ActivityFeed />
    </main>
  );
}
```

---

## Environment Variable

Add to `.env.local` and deployment config:

```bash
NEXT_PUBLIC_GATEWAY_URL=http://localhost:3001
```

In production: `NEXT_PUBLIC_GATEWAY_URL=https://gateway.opentriologue.ai`

---

## Testing

Manual test checklist:
1. Navigate to `/activity` — page loads, "Waiting for events..." shown, badge shows "Live"
2. Trigger an agent registration via curl/MCP — event appears in feed within 500ms
3. Trigger a state.set — event appears with correct color (violet)
4. Use agent filter — only selected agent's events shown
5. Use event type filter — only selected event type shown
6. Disconnect network — badge shows "Reconnecting...", reconnects automatically
7. After reconnect — missed events appear (Last-Event-ID replay)
8. Click "Clear" — feed empties, new events still appear

---

## Definition of Done

- [ ] `/activity` route renders without errors
- [ ] `useActivityStream` hook connects to SSE, receives events
- [ ] New events appear in real-time (< 500ms from emission)
- [ ] Filter by agent ID works
- [ ] Filter by event type works
- [ ] Connection badge shows Live/Reconnecting correctly
- [ ] Auto-reconnect with exponential backoff works
- [ ] "Clear" button works
- [ ] Nav link to `/activity` added
- [ ] `NEXT_PUBLIC_GATEWAY_URL` configured in deployment
